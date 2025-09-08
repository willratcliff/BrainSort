// Brainstorm page functionality

// Simple obfuscation functions
function obfuscateKey(key) {
    // Shift each character by 3 positions and then base64 encode
    const shifted = key.split('').map(char => String.fromCharCode(char.charCodeAt(0) + 3)).join('');
    return btoa(shifted);
}

function deobfuscateKey(obfuscated) {
    try {
        const decoded = atob(obfuscated);
        return decoded.split('').map(char => String.fromCharCode(char.charCodeAt(0) - 3)).join('');
    } catch {
        return null;
    }
}

// Obfuscated key - this is the encoded version of your BrainSort key
const OBFUSCATED_KEY = 'dm4wcnUweTQwZGY1NGQ5NzxoODVkNzs4OzNnMzM5ZGg7O2Q0N2Q5ZmlmZTk7Nzc3PGVnO2Q2ZTtkNTU2aDU2Ojk1aTk1aGdlNA==';

let OPENROUTER_API_KEY = localStorage.getItem('openrouter_api_key') || deobfuscateKey(OBFUSCATED_KEY);
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

let currentUser = null;
let currentModel = 'google/gemini-2.5-flash';
let taskData = null;
let brainstormTemplates = [];

// Get URL parameters
function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        user: params.get('user'),
        taskName: params.get('taskName'),
        quadrant: params.get('quadrant'),
        model: params.get('model')
    };
}

// User data functions
function getUserData(key) {
    if (!currentUser) return null;
    const storageKey = `user_${currentUser}_${key}`;
    return localStorage.getItem(storageKey);
}

function setUserData(key, value) {
    if (!currentUser) return;
    const storageKey = `user_${currentUser}_${key}`;
    localStorage.setItem(storageKey, value);
}

// Template functions
function loadTemplates() {
    const saved = getUserData('brainstorm_templates');
    if (saved) {
        try {
            brainstormTemplates = JSON.parse(saved);
        } catch (e) {
            console.error('Error loading templates:', e);
            brainstormTemplates = [];
        }
    } else {
        brainstormTemplates = [];
    }
}

function getTemplate(templateId) {
    return brainstormTemplates.find(t => t.id === templateId) || null;
}

// Brain dump context lookup for brainstorm page
function findBrainDumpById(brainDumpId) {
    if (!brainDumpId) return null;
    
    const logs = JSON.parse(getUserData('brainDumpLogs') || '[]');
    return logs.find(log => log.id === brainDumpId);
}

function getBrainDumpContextForTask() {
    // Try to get brain dump context from URL parameters if task has brain dump ID
    const params = getUrlParams();
    const brainDumpId = params.brainDumpId;
    
    if (brainDumpId) {
        const brainDumpLog = findBrainDumpById(brainDumpId);
        return brainDumpLog ? brainDumpLog.brainDump : null;
    }
    
    return null;
}

function substituteTemplateVariables(template, taskData) {
    if (!template || !template.prompt) return '';
    
    let prompt = template.prompt;
    const now = new Date();
    
    const variables = {
        task: taskData?.taskName || 'this task',
        quadrant: taskData?.quadrant || 'unknown',
        user: currentUser || 'User',
        date: now.toLocaleDateString(),
        time: now.toLocaleTimeString()
    };
    
    for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`\\{${key}\\}`, 'gi');
        prompt = prompt.replace(regex, value);
    }
    
    return prompt;
}

function populateTemplateSelector() {
    const selector = document.getElementById('brainstormTemplateSelect');
    if (!selector) return;
    
    // Clear existing options except first
    while (selector.children.length > 1) {
        selector.removeChild(selector.lastChild);
    }
    
    brainstormTemplates.forEach(template => {
        const option = document.createElement('option');
        option.value = template.id;
        option.textContent = template.name;
        selector.appendChild(option);
    });
}

function showTemplateContext(templateId) {
    const template = getTemplate(templateId);
    const contextDisplay = document.getElementById('templateContextDisplay');
    
    if (!template || !contextDisplay) {
        if (contextDisplay) contextDisplay.style.display = 'none';
        return;
    }
    
    const substitutedPrompt = substituteTemplateVariables(template, taskData);
    
    contextDisplay.innerHTML = `
        <h4>Template: ${template.name}</h4>
        <p><strong>Context:</strong> ${substitutedPrompt}</p>
    `;
    contextDisplay.style.display = 'block';
}

// AI Communication
async function sendToAI(prompt, templateContext = '') {
    // Build context about the current task
    const quadrantNames = {
        triggers: 'Set in Motion (2-5 minute tasks that unblock next steps)',
        marinate: 'Marinate (Ideas to jot down and let simmer)', 
        deepwork: 'Deep Work (Tasks requiring extended focus)',
        quickwins: 'Quick Wins (Short tasks for momentum)'
    };
    
    const taskContext = `TASK CONTEXT:
- Task: "${taskData?.taskName || 'Unknown task'}"
- Category: ${quadrantNames[taskData?.quadrant] || taskData?.quadrant || 'Unknown category'}
- User: ${currentUser || 'User'}`;
    
    // Get brain dump context if available
    const brainDumpContext = getBrainDumpContextForTask();
    
    let fullPrompt = `${taskContext}\n\n`;
    
    if (brainDumpContext) {
        fullPrompt += `ORIGINAL BRAIN DUMP CONTEXT:
This task was created from the following brain dump session:
"${brainDumpContext}"

`;
    }
    
    if (templateContext) {
        fullPrompt += `TEMPLATE CONTEXT:\n${templateContext}\n\n`;
    }
    fullPrompt += `USER REQUEST:\n${prompt}`;
    
    const systemPrompt = `You are a helpful brainstorming assistant working on productivity tasks. The user has organized their tasks into categories (Set in Motion, Marinate, Deep Work, Quick Wins) and needs help with a specific task.

You have access to the user's name and the original brain dump context that generated this task. Use this information to provide personalized, contextually relevant assistance.

Focus on providing practical, actionable deliverables rather than conversational responses. When asked to draft something (emails, outlines, plans), provide the actual deliverable content without prefacing it with phrases like "Here's a draft" or "I suggest". Just deliver the requested content directly and professionally.

When writing emails or formal communications, use the user's actual name for signatures and sign-offs. Reference the original brain dump context when relevant to provide more intelligent assistance.

Always consider the task context, category, and original brain dump context when providing assistance.`;
    
    try {
        // Check if API key is available
        if (!OPENROUTER_API_KEY) {
            return 'Please set your OpenRouter API key first. Go back to the main page and click the model settings button to add your API key.';
        }

        const response = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'HTTP-Referer': window.location.origin,
                'X-Title': 'BrainSort'
            },
            body: JSON.stringify({
                model: currentModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: fullPrompt }
                ],
                temperature: 0.7,
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || 'Sorry, I couldn\'t generate a response.';
    } catch (error) {
        console.error('AI request error:', error);
        return `Error: ${error.message}`;
    }
}

function addBrainstormMessage(content, isUser = false) {
    const messagesContainer = document.getElementById('brainstormMessages');
    if (!messagesContainer) return;
    
    // Remove welcome message on first real message
    const welcome = messagesContainer.querySelector('.brainstorm-welcome');
    if (welcome) {
        welcome.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user' : 'ai'}`;
    
    if (isUser) {
        messageDiv.textContent = content;
    } else {
        // For AI messages, add copy button
        messageDiv.innerHTML = `
            <button class="copy-btn" onclick="copyAIContent(this)">Copy</button>
            ${content}
        `;
    }
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function copyAIContent(button) {
    const messageDiv = button.parentElement;
    // Get all text content and remove the copy button text and any AI prefix
    let content = messageDiv.textContent.replace('Copy', '').trim();
    
    // Remove "AI:" prefix if it exists
    content = content.replace(/^AI:\s*/, '');
    
    navigator.clipboard.writeText(content).then(() => {
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        setTimeout(() => {
            button.textContent = originalText;
        }, 2000);
    }).catch(err => {
        console.error('Copy failed:', err);
        alert('Copy failed. Please select and copy manually.');
    });
}

async function sendBrainstormMessage() {
    const promptInput = document.getElementById('brainstormPrompt');
    const sendBtn = document.getElementById('sendBrainstormBtn');
    const templateSelect = document.getElementById('brainstormTemplateSelect');
    
    if (!promptInput || !sendBtn) return;
    
    const prompt = promptInput.value.trim();
    if (!prompt) return;
    
    // Get selected template context
    let templateContext = '';
    if (templateSelect && templateSelect.value) {
        const template = getTemplate(templateSelect.value);
        if (template) {
            templateContext = substituteTemplateVariables(template, taskData);
        }
    }
    
    // Show user message
    addBrainstormMessage(prompt, true);
    
    // Clear input and disable button
    promptInput.value = '';
    sendBtn.disabled = true;
    sendBtn.textContent = 'Thinking...';
    document.body.classList.add('loading');
    
    try {
        const response = await sendToAI(prompt, templateContext);
        addBrainstormMessage(response, false);
    } catch (error) {
        addBrainstormMessage(`Error: ${error.message}`, false);
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send Request';
        document.body.classList.remove('loading');
        promptInput.focus();
    }
}

function clearBrainstormConversation() {
    const messagesContainer = document.getElementById('brainstormMessages');
    if (!messagesContainer) return;
    
    messagesContainer.innerHTML = `
        <div class="brainstorm-welcome">
            <p>👋 Hi! I'm here to help you brainstorm and work through this task. What would you like to explore?</p>
        </div>
    `;
}

// Initialize page
document.addEventListener('DOMContentLoaded', function() {
    const params = getUrlParams();
    
    currentUser = params.user;
    currentModel = params.model || 'google/gemini-2.5-flash';
    
    taskData = {
        taskName: params.taskName,
        quadrant: params.quadrant
    };
    
    // Set task context in header
    const taskQuadrant = document.getElementById('taskQuadrant');
    const taskName = document.getElementById('taskName');
    
    if (taskQuadrant) {
        const quadrantNames = {
            triggers: '🚀 Set in Motion',
            marinate: '🧠 Marinate', 
            deepwork: '🎯 Deep Work',
            quickwins: '✅ Quick Wins'
        };
        taskQuadrant.textContent = quadrantNames[params.quadrant] || params.quadrant;
    }
    
    if (taskName) {
        taskName.textContent = params.taskName || 'Unknown Task';
    }
    
    // Load templates and populate selector
    loadTemplates();
    populateTemplateSelector();
    
    // Set up template selector change handler
    const templateSelect = document.getElementById('brainstormTemplateSelect');
    if (templateSelect) {
        templateSelect.addEventListener('change', function() {
            showTemplateContext(this.value);
        });
    }
    
    // Set up send button
    const sendBtn = document.getElementById('sendBrainstormBtn');
    if (sendBtn) {
        sendBtn.addEventListener('click', sendBrainstormMessage);
    }
    
    // Set up enter key in textarea and auto-populate with task
    const promptInput = document.getElementById('brainstormPrompt');
    if (promptInput) {
        // Auto-populate with the task text if available
        if (params.taskName) {
            promptInput.value = params.taskName;
            promptInput.select(); // Select the text so user can easily replace it
        }
        
        promptInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendBrainstormMessage();
            }
        });
        
        promptInput.focus();
    }
});