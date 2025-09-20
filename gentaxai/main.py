import os
import json
import uuid
from typing import List, Dict, Optional
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from dotenv import load_dotenv

from langchain_groq import ChatGroq
from langchain.schema import HumanMessage, SystemMessage, AIMessage


from gentaxai.knowledge import retrieve


load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")

if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY not found in environment variables")

# ✅ Initialize ChatGroq
llm = ChatGroq(
    groq_api_key=GROQ_API_KEY,
    model=GROQ_MODEL,
    temperature=0.2,
    max_tokens=800,
)

# FastAPI app
app = FastAPI(title="GenTaxAI Chatbot", description="AI-powered Indian Tax Assistant")
app.mount("/static", StaticFiles(directory="static"), name="static")

# Load or initialize conversation sessions
SESSIONS_FILE = "sessions.json"
if os.path.exists(SESSIONS_FILE):
    try:
        with open(SESSIONS_FILE, "r", encoding="utf-8") as f:
            CONVERSATIONS: Dict[str, List[Dict[str, str]]] = json.load(f)
    except json.JSONDecodeError:
        CONVERSATIONS = {}
else:
    CONVERSATIONS: Dict[str, List[Dict[str, str]]] = {}

def save_sessions():
    try:
        with open(SESSIONS_FILE, "w", encoding="utf-8") as f:
            json.dump(CONVERSATIONS, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print("Error saving sessions:", e)

# Request/response models
class ChatQuery(BaseModel):
    question: str
    session_id: Optional[str] = None

class ChatResponse(BaseModel):
    answer: str
    session_id: Optional[str] = None
    citations: Optional[List[Dict[str, str]]] = None

class SessionResponse(BaseModel):
    session_id: str
    message: str

SYSTEM_PROMPT = (
    "You are GenTaxAI, a precise and helpful Indian tax assistant.\n"
    "You specialize in Indian taxation including Income Tax, GST, MSME, RBI, SEBI and related compliance.\n"
    "Use the provided CONTEXT snippets as the primary source of truth. If a user asks "
    "for something covered in context, quote or paraphrase that accurately. If the answer "
    "is not in context, answer from your knowledge carefully and clearly say when you are not certain.\n"
    "Always prefer official wording in the snippets when giving definitions or rules.\n"
    "Keep responses concise but comprehensive."
)

def to_langchain_messages(history: List[Dict[str, str]]):
    msgs = []
    for msg in history:
        role = msg["role"]
        if role == "system":
            msgs.append(SystemMessage(content=msg["content"]))
        elif role == "user":
            msgs.append(HumanMessage(content=msg["content"]))
        elif role == "assistant":
            msgs.append(AIMessage(content=msg["content"]))
    return msgs

# Routes
@app.get("/", response_class=HTMLResponse)
async def read_root():
    index_path = os.path.join("static", "index.html")
    if not os.path.exists(index_path):
        return HTMLResponse(content="<h1>GenTaxAI</h1><p>static/index.html not found.</p>", status_code=200)
    with open(index_path, "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read(), status_code=200)

@app.post("/api/chat", response_model=ChatResponse)
async def chat_endpoint(query: ChatQuery):
    question = (query.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="Empty question")

    session_id = query.session_id or str(uuid.uuid4())
    if session_id not in CONVERSATIONS:
        CONVERSATIONS[session_id] = [{"role": "system", "content": SYSTEM_PROMPT}]

    # Retrieve relevant KB snippets
    try:
        kb_hits = retrieve(question, k=5) or []
    except Exception as e:
        print("Retriever error:", e)
        kb_hits = []

    citations_payload: List[Dict[str, str]] = []
    if kb_hits:
        context_texts = []
        for i, hit in enumerate(kb_hits, start=1):
            source = str(hit.get("source", "knowledge_base"))
            chunk_id = str(hit.get("chunk_id", i))
            text = str(hit.get("text", "")).strip()
            tag = f"[{i}] {source}#chunk{chunk_id}"
            context_texts.append(f"{tag}\n{text}")
            citations_payload.append({"id": str(i), "source": source, "chunk_id": chunk_id})
        context_block = "CONTEXT:\n" + "\n\n".join(context_texts)
        CONVERSATIONS[session_id].append({"role": "assistant", "content": context_block})

    # Add user question
    CONVERSATIONS[session_id].append({"role": "user", "content": question})
    lc_messages = to_langchain_messages(CONVERSATIONS[session_id])

    # Generate response
    try:
        response = llm.invoke(lc_messages)
        answer = response.content
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM error: {str(e)}")

    CONVERSATIONS[session_id].append({"role": "assistant", "content": answer})
    save_sessions()

    return ChatResponse(answer=answer, session_id=session_id, citations=citations_payload)

@app.post("/api/new-session", response_model=SessionResponse)
def new_session():
    session_id = str(uuid.uuid4())
    return SessionResponse(session_id=session_id, message="New session created")

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "service": "GenTaxAI Chatbot"}

# Run app for local dev (Render will auto-detect `app`)
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "gentaxai.main:app",  # ✅ required for deployment
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", 8000)),
        reload=os.getenv("ENV", "dev") == "dev",  # only reload in dev
    )






