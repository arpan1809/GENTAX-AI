/**
 * GenTaxAI Chatbot Frontend JavaScript
 * Handles all user interactions and API communications
 */

class ChatBot {
    constructor() {
        this.sessionId = null;
        this.isTyping = false;
        this.messageHistory = [];
        
        this.initializeElements();
        this.attachEventListeners();
        this.generateSessionId();
        
        // Show welcome screen initially
        this.showWelcomeScreen();
    }

    /**
     * Initialize DOM elements
     */
    initializeElements() {
        // Main elements
        this.welcomeScreen = document.getElementById('welcomeScreen');
        this.chatInterface = document.getElementById('chatInterface');
        this.chatMessages = document.getElementById('chatMessages');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.newChatBtn = document.getElementById('newChatBtn');
        
        // UI elements
        this.typingIndicator = document.getElementById('typingIndicator');
        this.loadingOverlay = document.getElementById('loadingOverlay');
        this.errorToast = document.getElementById('errorToast');
        this.errorMessage = document.getElementById('errorMessage');
        this.charCounter = document.getElementById('charCounter');
        
        // Sample question buttons
        this.sampleBtns = document.querySelectorAll('.sample-btn');
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        // Send button click
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        
        // Enter key press
        this.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Input changes
        this.messageInput.addEventListener('input', () => {
            this.handleInputChange();
            this.autoResize();
        });
        
        // New chat button
        this.newChatBtn.addEventListener('click', () => this.startNewChat());
        
        // Sample question buttons
        this.sampleBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const question = btn.getAttribute('data-question');
                this.askSampleQuestion(question);
            });
        });
        
        // Auto-focus on input when chat interface is shown
        document.addEventListener('click', (e) => {
            if (this.chatInterface.style.display !== 'none' && 
                !e.target.closest('.message') && 
                !e.target.closest('button')) {
                this.messageInput.focus();
            }
        });
    }

    /**
     * Generate a new session ID
     */
    generateSessionId() {
        this.sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Handle input changes
     */
    handleInputChange() {
        const text = this.messageInput.value.trim();
        const charCount = this.messageInput.value.length;
        
        // Update character counter
        this.charCounter.textContent = `${charCount}/1000`;
        
        // Enable/disable send button
        this.sendBtn.disabled = !text || this.isTyping;
        
        // Update character counter color
        if (charCount > 900) {
            this.charCounter.style.color = 'var(--warning-color)';
        } else if (charCount > 950) {
            this.charCounter.style.color = 'var(--error-color)';
        } else {
            this.charCounter.style.color = 'var(--text-light)';
        }
    }

    /**
     * Auto-resize textarea
     */
    autoResize() {
        this.messageInput.style.height = 'auto';
        this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 120) + 'px';
    }

    /**
     * Show welcome screen
     */
    showWelcomeScreen() {
        this.welcomeScreen.style.display = 'flex';
        this.chatInterface.style.display = 'none';
    }

    /**
     * Show chat interface
     */
    showChatInterface() {
        this.welcomeScreen.style.display = 'none';
        this.chatInterface.style.display = 'flex';
        this.messageInput.focus();
    }

    /**
     * Ask a sample question
     */
    askSampleQuestion(question) {
        this.messageInput.value = question;
        this.handleInputChange();
        this.sendMessage();
    }

    /**
     * Send message to the chatbot
     */
    async sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message || this.isTyping) return;

        // Clear input and show chat interface if needed
        this.messageInput.value = '';
        this.handleInputChange();
        this.autoResize();
        
        if (this.chatInterface.style.display === 'none') {
            this.showChatInterface();
        }

        // Add user message to chat
        this.addMessage(message, 'user');

        // Show typing indicator
        this.showTypingIndicator();

        try {
            const response = await this.sendToAPI(message);
            this.hideTypingIndicator();
            this.addMessage(response.answer, 'assistant');
            
            // Store session ID from response
            if (response.session_id) {
                this.sessionId = response.session_id;
            }
        } catch (error) {
            this.hideTypingIndicator();
            this.showError('Failed to get response. Please try again.');
            console.error('Chat error:', error);
        } finally {
            // Always reset typing state and button
            this.isTyping = false;
            this.handleInputChange();
        }
    }

    /**
     * Send message to API
     */
    async sendToAPI(message) {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                question: message,
                session_id: this.sessionId
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.detail || `HTTP ${response.status}`);
        }

        return await response.json();
    }

    /**
     * Add message to chat
     */
    addMessage(text, sender) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender} fade-in`;
        
        const timestamp = new Date().toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        const avatar = sender === 'user' ? '👤' : '🤖';
        
        messageDiv.innerHTML = `
            <div class="message-avatar">${avatar}</div>
            <div class="message-content">
                <div class="message-bubble">${this.formatMessage(text)}</div>
                <div class="message-time">${timestamp}</div>
            </div>
        `;
        
        this.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
        
        // Add to message history
        this.messageHistory.push({ text, sender, timestamp });
    }

    /**
     * Format message text (basic markdown-like formatting)
     */
    formatMessage(text) {
        return text
            .replace(/\n/g, '<br>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>');
    }

    /**
     * Show typing indicator
     */
    showTypingIndicator() {
        this.isTyping = true;
        this.sendBtn.disabled = true;
        this.typingIndicator.style.display = 'block';
        this.scrollToBottom();
    }

    /**
     * Hide typing indicator
     */
    hideTypingIndicator() {
        this.isTyping = false;
        this.handleInputChange();
        this.typingIndicator.style.display = 'none';
    }

    /**
     * Scroll chat to bottom
     */
    scrollToBottom() {
        setTimeout(() => {
            this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        }, 100);
    }

    /**
     * Start new chat session
     */
    async startNewChat() {
        try {
            // Show loading
            this.showLoading();
            
            // Generate new session
            this.generateSessionId();
            
            // Clear chat
            this.chatMessages.innerHTML = '';
            this.messageHistory = [];
            
            // Show welcome screen
            this.showWelcomeScreen();
            
            // Hide loading
            this.hideLoading();
            
            // Reset input
            this.messageInput.value = '';
            this.handleInputChange();
            this.autoResize();
            
        } catch (error) {
            this.hideLoading();
            this.showError('Failed to start new chat. Please refresh the page.');
            console.error('New chat error:', error);
        }
    }

    /**
     * Show loading overlay
     */
    showLoading() {
        this.loadingOverlay.style.display = 'flex';
    }

    /**
     * Hide loading overlay
     */
    hideLoading() {
        this.loadingOverlay.style.display = 'none';
    }

    /**
     * Show error toast
     */
    showError(message) {
        this.errorMessage.textContent = message;
        this.errorToast.style.display = 'block';
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            this.hideError();
        }, 5000);
    }

    /**
     * Hide error toast
     */
    hideError() {
        this.errorToast.style.display = 'none';
    }

    /**
     * Handle connection errors
     */
    handleConnectionError() {
        this.showError('Connection error. Please check your internet connection.');
    }

    /**
     * Get chat history
     */
    getChatHistory() {
        return this.messageHistory;
    }

    /**
     * Export chat history
     */
    exportChatHistory() {
        const history = this.getChatHistory();
        const blob = new Blob([JSON.stringify(history, null, 2)], { 
            type: 'application/json' 
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gentaxai-chat-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// Initialize the chatbot when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.chatBot = new ChatBot();
    
    // Handle page visibility changes
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && window.chatBot.chatInterface.style.display !== 'none') {
            window.chatBot.messageInput.focus();
        }
    });
    
    // Handle online/offline status
    window.addEventListener('online', () => {
        console.log('Connection restored');
    });
    
    window.addEventListener('offline', () => {
        window.chatBot.showError('You are offline. Please check your connection.');
    });
    
    // Global error handler
    window.addEventListener('error', (e) => {
        console.error('Global error:', e.error);
        window.chatBot.showError('An unexpected error occurred. Please refresh the page.');
    });
});

// Add keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + Enter for new chat
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        window.chatBot.startNewChat();
    }
    
    // Escape to focus input
    if (e.key === 'Escape' && window.chatBot.chatInterface.style.display !== 'none') {
        e.preventDefault();
        window.chatBot.messageInput.focus();
    }
});

// Export for use in console/debugging
window.ChatBot = ChatBot;