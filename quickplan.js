// Demo API key (lightly obfuscated)
function getDemoKey() {
    const parts = [
        'sk-or-v1-',
        '15fdd2c51b86b15d',
        '84b248e93e09591f',
        'a325176bd84ce383',
        '9a2e26d615417ae3'
    ];
    return parts.join('');
}

const OPENROUTER_API_KEY = localStorage.getItem('openrouter_api_key') || getDemoKey();
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

let currentTasks = {
    triggers: [],
    marinate: [],
    deepwork: [],
    quickwins: []
};

let draggedTask = null;
let draggedFromQuadrant = null;
let draggedIndex = null;

document.addEventListener('DOMContentLoaded', () => {
    loadSavedTasks();
    loadCompletedTasks();
    setupEventListeners();
    setupDragAndDrop();
    
    if (hasActiveTasks()) {
        showQuadrants();
    }
});

function setupEventListeners() {
    document.getElementById('organizeBtn').addEventListener('click', organizeBrainDump);
    document.getElementById('interviewModeBtn').addEventListener('click', () => {
        window.location.href = 'index.html';
    });
    document.getElementById('historyBtn').addEventListener('click', () => showView('history'));
    document.getElementById('quickModeBtn').addEventListener('click', () => showView('quickplan'));
    
    document.getElementById('manualAddBtn')?.addEventListener('click', () => showManualAddModal());
    document.getElementById('cleanSlateBtn')?.addEventListener('click', cleanSlate);
    document.getElementById('exportLogBtn')?.addEventListener('click', exportLog);
    
    document.getElementById('confirmAddBtn')?.addEventListener('click', addTaskManually);
    document.getElementById('cancelAddBtn')?.addEventListener('click', hideManualAddModal);
    
    document.querySelectorAll('.add-task-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const quadrant = e.target.dataset.quadrant;
            showManualAddModal(quadrant);
        });
    });
}

function setupDragAndDrop() {
    const quadrants = document.querySelectorAll('.quadrant.droppable');
    
    quadrants.forEach(quadrant => {
        quadrant.addEventListener('dragover', handleDragOver);
        quadrant.addEventListener('drop', handleDrop);
        quadrant.addEventListener('dragenter', handleDragEnter);
        quadrant.addEventListener('dragleave', handleDragLeave);
    });
}

async function organizeBrainDump() {
    const input = document.getElementById('brainDumpInput').value.trim();
    
    if (!input) {
        alert('Please write down what\'s on your mind first!');
        return;
    }
    
    showLoading(true);
    
    const prompt = `Analyze this brain dump and organize the tasks into four quadrants:

1. Set in Motion (key: "triggers"): 2-5 minute tasks that unblock next steps
2. Marinate (key: "marinate"): Ideas/thoughts to capture so they're not taking up mental bandwidth  
3. Deep Work (key: "deepwork"): Tasks requiring 1+ hours of focused time
4. Quick Wins (key: "quickwins"): 10-30 minute tasks for momentum

Brain dump:
${input}

Extract ALL tasks and ideas mentioned. Be specific and action-oriented. Include everything, even if it seems minor.

Return ONLY this JSON format:
{
    "triggers": ["task1", "task2"],
    "marinate": ["idea1", "idea2"],
    "deepwork": ["task1", "task2"],
    "quickwins": ["task1", "task2"]
}`;

    try {
        // Check if API key is available
        if (!OPENROUTER_API_KEY) {
            throw new Error('Please set your OpenRouter API key first.');
        }

        const response = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.href,
                'X-Title': 'Quick Day Planner'
            },
            body: JSON.stringify({
                model: 'google/gemini-2.0-flash-001',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a task organization assistant. Analyze text and categorize tasks into quadrants. Always respond with valid JSON only.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.statusText}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;
        
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const tasks = JSON.parse(jsonMatch[0]);
            currentTasks = tasks;
            displayQuadrants(tasks);
            saveTasks();
            saveLog(input, tasks);
        }
    } catch (error) {
        console.error('Error organizing tasks:', error);
        alert('Error organizing tasks. Please try again.');
    } finally {
        showLoading(false);
    }
}

function displayQuadrants(tasks) {
    document.querySelector('.brain-dump-section').style.display = 'none';
    document.querySelector('.quadrants-section').style.display = 'block';
    
    displayTaskList('triggers-list', tasks.triggers || [], 'triggers');
    displayTaskList('marinate-list', tasks.marinate || [], 'marinate');
    displayTaskList('deepwork-list', tasks.deepwork || [], 'deepwork');
    displayTaskList('quickwins-list', tasks.quickwins || [], 'quickwins');
}

function displayTaskList(listId, tasks, quadrantKey) {
    const list = document.getElementById(listId);
    list.innerHTML = '';
    
    tasks.forEach((task, index) => {
        const li = document.createElement('li');
        li.className = 'task-item draggable';
        li.draggable = true;
        li.dataset.quadrant = quadrantKey;
        li.dataset.index = index;
        
        li.innerHTML = `
            <input type="checkbox" id="${listId}-${index}" onchange="toggleTask('${listId}', ${index}, '${quadrantKey}')">
            <label for="${listId}-${index}">${task}</label>
            <button class="delete-btn" onclick="deleteTask('${quadrantKey}', ${index})" title="Delete">×</button>
        `;
        
        li.addEventListener('dragstart', handleDragStart);
        li.addEventListener('dragend', handleDragEnd);
        
        list.appendChild(li);
    });
}

function handleDragStart(e) {
    draggedTask = e.target;
    draggedFromQuadrant = e.target.dataset.quadrant;
    draggedIndex = parseInt(e.target.dataset.index);
    e.target.classList.add('dragging');
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
}

function handleDragOver(e) {
    e.preventDefault();
}

function handleDragEnter(e) {
    if (e.target.classList.contains('droppable')) {
        e.target.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    if (e.target.classList.contains('droppable')) {
        e.target.classList.remove('drag-over');
    }
}

function handleDrop(e) {
    e.preventDefault();
    
    const dropZone = e.target.closest('.quadrant.droppable');
    if (!dropZone) return;
    
    dropZone.classList.remove('drag-over');
    
    const targetQuadrant = dropZone.dataset.quadrant;
    
    if (targetQuadrant === draggedFromQuadrant) return;
    
    const taskText = currentTasks[draggedFromQuadrant][draggedIndex];
    
    currentTasks[draggedFromQuadrant].splice(draggedIndex, 1);
    currentTasks[targetQuadrant].push(taskText);
    
    displayTaskList(`${draggedFromQuadrant}-list`, currentTasks[draggedFromQuadrant], draggedFromQuadrant);
    displayTaskList(`${targetQuadrant}-list`, currentTasks[targetQuadrant], targetQuadrant);
    
    saveTasks();
}

function toggleTask(listId, index, quadrantKey) {
    const checkbox = document.getElementById(`${listId}-${index}`);
    const taskItem = checkbox.parentElement;
    
    if (checkbox.checked) {
        taskItem.classList.add('completed');
        const task = currentTasks[quadrantKey][index];
        saveCompletedTask(task, quadrantKey);
        
        setTimeout(() => {
            currentTasks[quadrantKey].splice(index, 1);
            displayTaskList(listId, currentTasks[quadrantKey], quadrantKey);
            saveTasks();
        }, 500);
    }
}

function deleteTask(quadrantKey, index) {
    if (confirm('Delete this task?')) {
        currentTasks[quadrantKey].splice(index, 1);
        displayTaskList(`${quadrantKey}-list`, currentTasks[quadrantKey], quadrantKey);
        saveTasks();
    }
}

function saveCompletedTask(task, quadrant) {
    const completed = JSON.parse(localStorage.getItem('completedTasks') || '[]');
    const today = new Date().toISOString().split('T')[0];
    
    completed.push({
        task: task,
        quadrant: quadrant,
        date: today,
        timestamp: new Date().toISOString()
    });
    
    localStorage.setItem('completedTasks', JSON.stringify(completed));
}

function loadCompletedTasks() {
    const completed = JSON.parse(localStorage.getItem('completedTasks') || '[]');
    const grouped = {};
    
    completed.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    completed.forEach(item => {
        if (!grouped[item.date]) {
            grouped[item.date] = [];
        }
        grouped[item.date].push(item);
    });
    
    const container = document.getElementById('completedTasksList');
    if (!container) return;
    
    container.innerHTML = '';
    
    Object.keys(grouped).sort().reverse().forEach(date => {
        const dayGroup = document.createElement('div');
        dayGroup.className = 'day-group';
        
        const header = document.createElement('div');
        header.className = 'day-header';
        header.textContent = formatDate(date);
        dayGroup.appendChild(header);
        
        grouped[date].forEach(item => {
            const taskDiv = document.createElement('div');
            taskDiv.className = 'completed-task';
            taskDiv.textContent = `✓ ${item.task}`;
            dayGroup.appendChild(taskDiv);
        });
        
        container.appendChild(dayGroup);
    });
}

function formatDate(dateString) {
    const date = new Date(dateString + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.getTime() === today.getTime()) {
        return 'Today';
    } else if (date.getTime() === yesterday.getTime()) {
        return 'Yesterday';
    } else {
        return date.toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
    }
}

function saveTasks() {
    localStorage.setItem('currentTasks', JSON.stringify(currentTasks));
    localStorage.setItem('lastUpdated', new Date().toISOString());
}

function loadSavedTasks() {
    const saved = localStorage.getItem('currentTasks');
    if (saved) {
        currentTasks = JSON.parse(saved);
    }
}

function hasActiveTasks() {
    return Object.values(currentTasks).some(tasks => tasks.length > 0);
}

function showQuadrants() {
    document.querySelector('.brain-dump-section').style.display = 'none';
    document.querySelector('.quadrants-section').style.display = 'block';
    displayQuadrants(currentTasks);
}

function cleanSlate() {
    if (confirm('This will clear ALL tasks including completed history. Continue?')) {
        currentTasks = {
            triggers: [],
            marinate: [],
            deepwork: [],
            quickwins: []
        };
        
        // Clear completed tasks
        localStorage.removeItem('completedTasks');
        
        saveTasks();
        location.reload();
    }
}

function showManualAddModal(preselectedQuadrant = null) {
    document.getElementById('manualAddModal').style.display = 'flex';
    document.getElementById('newTaskInput').value = '';
    
    if (preselectedQuadrant) {
        document.getElementById('quadrantSelect').value = preselectedQuadrant;
    }
    
    document.getElementById('newTaskInput').focus();
}

function hideManualAddModal() {
    document.getElementById('manualAddModal').style.display = 'none';
}

function addTaskManually() {
    const taskText = document.getElementById('newTaskInput').value.trim();
    const quadrant = document.getElementById('quadrantSelect').value;
    
    if (!taskText) {
        alert('Please enter a task description');
        return;
    }
    
    currentTasks[quadrant].push(taskText);
    displayTaskList(`${quadrant}-list`, currentTasks[quadrant], quadrant);
    saveTasks();
    hideManualAddModal();
}

function exportLog() {
    const logs = JSON.parse(localStorage.getItem('quickPlanLogs') || '[]');
    
    const dataStr = JSON.stringify(logs, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `quickplan-logs-${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
}

function saveLog(brainDump, tasks) {
    const logs = JSON.parse(localStorage.getItem('quickPlanLogs') || '[]');
    logs.push({
        timestamp: new Date().toISOString(),
        brainDump: brainDump,
        categorizedTasks: tasks
    });
    localStorage.setItem('quickPlanLogs', JSON.stringify(logs));
}

function showView(view) {
    const quickPlanView = document.getElementById('quickPlanView');
    const historyView = document.getElementById('historyView');
    
    if (view === 'history') {
        quickPlanView.style.display = 'none';
        historyView.style.display = 'block';
        loadCompletedTasks();
    } else {
        quickPlanView.style.display = 'block';
        historyView.style.display = 'none';
    }
}

function showLoading(show) {
    if (show) {
        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.id = 'loadingOverlay';
        overlay.innerHTML = `
            <div>
                <div class="loading-spinner"></div>
                <div class="loading-text">Organizing your tasks...</div>
            </div>
        `;
        document.body.appendChild(overlay);
    } else {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.remove();
        }
    }
}