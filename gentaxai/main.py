import os
import json
from urllib.parse import quote_plus
from urllib.request import urlopen
from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import asyncio
from contextlib import asynccontextmanager

from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

load_dotenv()

class Config:
    EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
    FAISS_INDEX_PATH = "faiss_index"
    GROQ_MODEL = "llama-3.1-8b-instant"
    GROQ_API_KEY = os.getenv("GROQ_API_KEY")

SYSTEM_PROMPT = """You are GenTaxAI, an expert on Indian tax, GST, investment regulations, and stock market basics.

Retrieved Context:
{context}
---

Web Context:
{web_context}
---

Instructions:
- Think like a senior tax consultant: reason step-by-step internally and provide a precise final answer.
- For stock-related queries, act like a prudent market research analyst (not a hype advisor).
- Use the retrieved context first; do not ignore it.
- Use web context to improve freshness and cite it when used.
- If context is empty or irrelevant, use strong domain knowledge and clearly mention assumptions.
- Provide polished markdown with headings, bullets, and tables when helpful.
- For rates, slabs, thresholds, due dates, or comparisons, prefer table format.
- For stock/fund comparisons, use tables with key metrics (sector, valuation proxy, risk, horizon fit).
- Avoid guaranteed return language; include risk-aware guidance when discussing investments.
- End with a "Sources" section using markdown links.
- Never give generic filler responses.

Return only the final answer in markdown."""


retriever = None
llm = None
models_loaded = False


def fetch_web_context(query: str, max_sources: int = 3):
    """
    Fetch concise web snippets + URLs from public DuckDuckGo instant answer API.
    This does not require API keys and is used only to enrich responses.
    """
    endpoint = f"https://api.duckduckgo.com/?q={quote_plus(query)}&format=json&no_html=1&skip_disambig=1"
    web_chunks = []
    sources = []
    try:
        with urlopen(endpoint, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))

        abstract = (payload.get("AbstractText") or "").strip()
        abstract_url = (payload.get("AbstractURL") or "").strip()
        heading = (payload.get("Heading") or "").strip()

        if abstract:
            title = heading or "DuckDuckGo Instant Answer"
            web_chunks.append(f"{title}: {abstract}")
            if abstract_url:
                sources.append({"title": title, "url": abstract_url, "kind": "web"})

        related = payload.get("RelatedTopics", []) or []
        for item in related:
            if len(sources) >= max_sources:
                break
            if isinstance(item, dict) and item.get("Text") and item.get("FirstURL"):
                web_chunks.append(item["Text"])
                sources.append(
                    {
                        "title": item["Text"][:72],
                        "url": item["FirstURL"],
                        "kind": "web",
                    }
                )
            elif isinstance(item, dict) and item.get("Topics"):
                for nested in item.get("Topics", []):
                    if len(sources) >= max_sources:
                        break
                    if nested.get("Text") and nested.get("FirstURL"):
                        web_chunks.append(nested["Text"])
                        sources.append(
                            {
                                "title": nested["Text"][:72],
                                "url": nested["FirstURL"],
                                "kind": "web",
                            }
                        )
    except Exception as exc:
        print(f" Web context fetch skipped: {exc}")

    return "\n".join(web_chunks[:5]) if web_chunks else "[No web context]", sources

async def load_models():
    """Load models in background without blocking startup"""
    global retriever, llm, models_loaded
    
    print(" Starting background model loading...")
    
    try:
       
        print(" Loading Groq LLM...")
        llm = ChatGroq(
            model_name=Config.GROQ_MODEL,
            api_key=Config.GROQ_API_KEY,
            temperature=0.3
        )
        print(f" LLM ready: {Config.GROQ_MODEL}")
        
        
        print(" Loading embedding model")
        embeddings = HuggingFaceEmbeddings(
            model_name=Config.EMBEDDING_MODEL,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"batch_size": 32}
        )
        print("Embeddings ready")
        
        
        if os.path.exists(Config.FAISS_INDEX_PATH):
            print(f" Loading FAISS index...")
            vectorstore = FAISS.load_local(
                Config.FAISS_INDEX_PATH,
                embeddings,
                allow_dangerous_deserialization=True
            )
            retriever = vectorstore.as_retriever(search_kwargs={"k": 4})
            print(" FAISS index ready")
        else:
            print(" No FAISS index found - using LLM knowledge only")
        
        models_loaded = True
        print(" All models loaded successfully!")
        
    except Exception as e:
        print(f" Error loading models: {e}")
        models_loaded = False

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Modern lifespan context manager for FastAPI"""
    print("=" * 60)
    print(" GenTaxAI Starting...")
    print("=" * 60)
    
    
    asyncio.create_task(load_models())
    
    print(" App started - models loading in background")
    print("=" * 60)
    
    yield  
    
    print("Shutting down...")

app = FastAPI(title="GenTaxAI", lifespan=lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    """Serve frontend"""
    return FileResponse("static/index.html")

@app.get("/health")
async def health():
    """Health check - shows model loading status"""
    return {
        "status": "ok",
        "models_loaded": models_loaded,
        "llm_ready": llm is not None,
        "retriever_ready": retriever is not None
    }

@app.post("/chat")
async def chat(request: Request):
    """Main chat endpoint"""
    
    if not models_loaded:
        return JSONResponse(
            status_code=503,
            content={
                "answer": " AI models are still loading ",
                "loading": True
            }
        )
    
    if not llm:
        raise HTTPException(status_code=500, detail="LLM not initialized")

    try:
        data = await request.json()
    except:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    query = data.get("message", "")
    if not query:
        raise HTTPException(status_code=400, detail="'message' required")

    print(f" Query: {query}")
    
    try:
       
        rag_sources = []
        if retriever:
            docs = retriever.get_relevant_documents(query)
            context = "\n\n".join([doc.page_content[:500] for doc in docs[:3]])
            rag_sources = [
                {
                    "title": doc.metadata.get("source", f"RAG source {idx + 1}"),
                    "url": "",
                    "kind": "rag_pdf",
                }
                for idx, doc in enumerate(docs[:3])
            ]
            print(f" Retrieved {len(docs)} docs")
        else:
            context = "[No knowledge base available]"
            print(" Using LLM knowledge only")

        web_context, web_sources = fetch_web_context(query)

      
        prompt = ChatPromptTemplate.from_messages([
            ("system", SYSTEM_PROMPT),
            ("human", "{question}")
        ])
        
        chain = prompt | llm | StrOutputParser()
        answer = chain.invoke(
            {
                "question": query,
                "context": context,
                "web_context": web_context,
            }
        )
        sources = rag_sources + web_sources
        
        print(f" Generated answer ({len(answer)} chars)")
        return JSONResponse({"answer": answer, "sources": sources})
        
    except Exception as e:
        print(f" Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

