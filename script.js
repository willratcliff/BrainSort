let OPENROUTER_API_KEY = localStorage.getItem('openrouter_api_key') || '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';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

let currentUser = null;
let currentModel = 'google/gemini-2.5-flash';

function getUserData(key) {
    if (!currentUser) return null;
    const storageKey = `user_${currentUser}_${key}`;
    const value = localStorage.getItem(storageKey);
    console.log(`[${currentUser}] Getting ${key}:`, value);
    return value;
}

function setUserData(key, value) {
    if (!currentUser) return;
    const storageKey = `user_${currentUser}_${key}`;
    localStorage.setItem(storageKey, value);
    console.log(`[${currentUser}] Setting ${key}:`, value);
}

function removeUserData(key) {
    if (!currentUser) return;
    localStorage.removeItem(`user_${currentUser}_${key}`);
}

let currentTasks = {
    triggers: [],
    marinate: [],
    deepwork: [],
    quickwins: []
};

// Template Management System
let brainstormTemplates = [];

function generateTemplateId() {
    return 'template_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function generateBrainDumpId() {
    return 'dump_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function generateTaskId() {
    return 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Task structure helpers
function createTaskObject(text, brainDumpId = null) {
    return {
        id: generateTaskId(),
        text: text,
        brainDumpId: brainDumpId,
        createdAt: new Date().toISOString()
    };
}

function getTaskText(task) {
    // Handle both old string format and new object format
    return typeof task === 'string' ? task : task.text;
}

function getTaskBrainDumpId(task) {
    return typeof task === 'object' && task.brainDumpId ? task.brainDumpId : null;
}

// Brain dump context lookup
function findBrainDumpById(brainDumpId) {
    if (!brainDumpId) return null;
    
    const logs = JSON.parse(getUserData('brainDumpLogs') || '[]');
    return logs.find(log => log.id === brainDumpId);
}

function getOriginalBrainDumpForTask(task) {
    const brainDumpId = getTaskBrainDumpId(task);
    if (!brainDumpId) return null;
    
    const brainDumpLog = findBrainDumpById(brainDumpId);
    return brainDumpLog ? brainDumpLog.brainDump : null;
}

// Migration function to convert old data to new format
function migrateTasks() {
    let migrated = false;
    
    // Migrate current tasks
    for (const quadrant in currentTasks) {
        const tasks = currentTasks[quadrant];
        for (let i = 0; i < tasks.length; i++) {
            if (typeof tasks[i] === 'string') {
                // Convert old string format to new object format
                tasks[i] = createTaskObject(tasks[i], null);
                migrated = true;
            }
        }
    }
    
    // Migrate brain dump logs to include IDs if missing
    const logs = JSON.parse(getUserData('brainDumpLogs') || '[]');
    let logsMigrated = false;
    
    for (const log of logs) {
        if (!log.id) {
            log.id = generateBrainDumpId();
            logsMigrated = true;
        }
    }
    
    if (logsMigrated) {
        setUserData('brainDumpLogs', JSON.stringify(logs));
    }
    
    if (migrated) {
        saveTasks();
        console.log('Tasks migrated to new format with IDs');
    }
    
    return migrated || logsMigrated;
}

function saveTemplates() {
    setUserData('brainstorm_templates', JSON.stringify(brainstormTemplates));
}

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

function createTemplate(name, description, prompt, tags = []) {
    const template = {
        id: generateTemplateId(),
        name: name.trim(),
        description: description.trim(),
        prompt: prompt.trim(),
        tags: Array.isArray(tags) ? tags : [],
        created: Date.now(),
        lastUsed: null,
        useCount: 0
    };
    
    brainstormTemplates.push(template);
    saveTemplates();
    return template;
}

function updateTemplate(templateId, updates) {
    const template = brainstormTemplates.find(t => t.id === templateId);
    if (template) {
        Object.assign(template, updates);
        saveTemplates();
        return template;
    }
    return null;
}

function deleteTemplate(templateId) {
    const index = brainstormTemplates.findIndex(t => t.id === templateId);
    if (index !== -1) {
        brainstormTemplates.splice(index, 1);
        saveTemplates();
        return true;
    }
    return false;
}

function getTemplate(templateId) {
    return brainstormTemplates.find(t => t.id === templateId) || null;
}

function getAllTemplates() {
    return [...brainstormTemplates].sort((a, b) => b.lastUsed - a.lastUsed);
}

function useTemplate(templateId) {
    const template = brainstormTemplates.find(t => t.id === templateId);
    if (template) {
        template.lastUsed = Date.now();
        template.useCount += 1;
        saveTemplates();
        return template;
    }
    return null;
}

function searchTemplates(query) {
    const lowercaseQuery = query.toLowerCase();
    return brainstormTemplates.filter(template => 
        template.name.toLowerCase().includes(lowercaseQuery) ||
        template.description.toLowerCase().includes(lowercaseQuery) ||
        template.tags.some(tag => tag.toLowerCase().includes(lowercaseQuery))
    );
}

function substituteTemplateVariables(templateText, taskText, quadrantName) {
    const quadrantNames = {
        triggers: 'Set in Motion',
        marinate: 'Marinate',
        deepwork: 'Deep Work',
        quickwins: 'Quick Wins'
    };
    
    return templateText
        .replace(/\{task\}/g, taskText || '')
        .replace(/\{quadrant\}/g, quadrantNames[quadrantName] || quadrantName || '')
        .replace(/\{user\}/g, currentUser || '')
        .replace(/\{date\}/g, new Date().toLocaleDateString())
        .replace(/\{time\}/g, new Date().toLocaleTimeString());
}

let draggedTask = null;
let draggedFromQuadrant = null;
let draggedIndex = null;

function initializeLandingPage() {
    const userNameInput = document.getElementById('userNameInput');
    const enterAppBtn = document.getElementById('enterAppBtn');
    const landingPage = document.getElementById('landingPage');
    const mainApp = document.getElementById('mainApp');
    
    userNameInput.addEventListener('input', () => {
        const name = userNameInput.value.trim();
        enterAppBtn.disabled = name.length < 2;
    });
    
    userNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !enterAppBtn.disabled) {
            enterApp();
        }
    });
    
    enterAppBtn.addEventListener('click', enterApp);
    
    function enterApp() {
        const name = userNameInput.value.trim();
        if (name.length < 2) return;
        
        console.log(`Entering app as user: ${name}`);
        
        // Clear any residual data first
        clearCurrentUserData();
        
        currentUser = name;
        localStorage.setItem('lastUser', currentUser);
        
        landingPage.style.display = 'none';
        mainApp.style.display = 'block';
        
        document.getElementById('currentUserDisplay').textContent = `User: ${currentUser}`;
        
        // Load user-specific model setting
        currentModel = getUserData('selectedModel') || 'google/gemini-2.5-flash';
        
        // Update model display
        document.getElementById('currentModel').textContent = currentModel;
        
        initializeApp();
    }
}

function showLandingPage() {
    document.getElementById('landingPage').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('userNameInput').focus();
}

function checkExistingUser() {
    const lastUser = localStorage.getItem('lastUser');
    if (lastUser) {
        // Clear any residual data first
        clearCurrentUserData();
        
        currentUser = lastUser;
        document.getElementById('landingPage').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        document.getElementById('currentUserDisplay').textContent = `User: ${currentUser}`;
        
        // Load user-specific model setting
        currentModel = getUserData('selectedModel') || 'google/gemini-2.5-flash';
        
        // Update model display
        document.getElementById('currentModel').textContent = currentModel;
        
        initializeApp();
    } else {
        showLandingPage();
    }
}

function initializeApp() {
    loadSavedTasks();
    loadCompletedTasks();
    loadTemplates();
    migrateTasks(); // Migrate old data to new format
    setupDragAndDrop();
    
    if (hasActiveTasks()) {
        showQuadrants();
    }
    
    document.getElementById('organizeBtn').addEventListener('click', organizeBrainDump);
    
    document.getElementById('brainDumpBtn').addEventListener('click', () => showView('braindump'));
    document.getElementById('quadrantsBtn').addEventListener('click', () => showView('quadrants'));
    document.getElementById('historyBtn').addEventListener('click', () => showView('history'));
    document.getElementById('brainDumpHistoryBtn').addEventListener('click', () => showView('brainhistory'));
    document.getElementById('templatesBtn').addEventListener('click', () => showView('templates'));
    document.getElementById('modelBtn').addEventListener('click', showModelModal);
    document.getElementById('switchUserBtn').addEventListener('click', switchUser);
    
    document.getElementById('newDumpBtn')?.addEventListener('click', () => showView('braindump'));
    document.getElementById('manualAddBtn')?.addEventListener('click', showManualAddModal);
    document.getElementById('printBtn')?.addEventListener('click', printTasks);
    document.getElementById('cleanSlateBtn')?.addEventListener('click', cleanSlate);
    
    document.getElementById('confirmAddBtn')?.addEventListener('click', addTaskManually);
    document.getElementById('cancelAddBtn')?.addEventListener('click', hideManualAddModal);
    
    document.getElementById('confirmModelBtn')?.addEventListener('click', saveModel);
    document.getElementById('cancelModelBtn')?.addEventListener('click', hideModelModal);
    document.getElementById('exportLogBtn')?.addEventListener('click', exportLog);
    document.getElementById('updateApiKeyBtn')?.addEventListener('click', updateApiKey);
    
    document.getElementById('backToBrainDumpBtn')?.addEventListener('click', () => showView('braindump'));
    document.getElementById('switchUserBtnHistory')?.addEventListener('click', switchUser);
    document.getElementById('historySearch')?.addEventListener('input', filterBrainDumpHistory);
    
    // Template page event listeners (these elements exist)
    document.getElementById('backFromTemplatesBtn')?.addEventListener('click', () => showView('braindump'));
    document.getElementById('switchUserBtnTemplates')?.addEventListener('click', switchUser);
    document.getElementById('createTemplateBtn')?.addEventListener('click', showTemplateModal);
    document.getElementById('exportTemplatesBtn')?.addEventListener('click', exportTemplates);
    document.getElementById('importTemplatesBtn')?.addEventListener('click', importTemplates);
    document.getElementById('templatesSearch')?.addEventListener('input', filterTemplates);
    document.getElementById('templateImportInput')?.addEventListener('change', handleTemplateImport);
    
    // Template modal event listeners (attached to document to handle dynamic content)
    document.addEventListener('click', function(e) {
        if (e.target && e.target.id === 'saveTemplateBtn') {
            saveTemplate();
        }
        if (e.target && e.target.id === 'cancelTemplateBtn') {
            hideTemplateModal();
        }
        if (e.target && e.target.classList.contains('create-template-cta')) {
            showTemplateModal();
        }
    });
    
    document.querySelectorAll('.add-task-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const quadrant = e.target.dataset.quadrant;
            showManualAddModal(quadrant);
        });
    });
}

function clearCurrentUserData() {
    // Clear in-memory data
    currentTasks = {
        triggers: [],
        marinate: [],
        deepwork: [],
        quickwins: []
    };
    
    brainstormTemplates = [];
    
    // Clear UI
    document.querySelectorAll('.task-list').forEach(list => {
        list.innerHTML = '';
    });
    
    document.getElementById('completedTasksList').innerHTML = '';
    document.getElementById('brainDumpInput').value = '';
    
    // Reset to brain dump view
    showView('braindump');
    
    // Reset model to default
    currentModel = 'google/gemini-2.5-flash';
}

function switchUser() {
    console.log(`Switching away from user: ${currentUser}`);
    clearCurrentUserData();
    currentUser = null;
    showLandingPage();
    document.getElementById('userNameInput').value = '';
    document.getElementById('enterAppBtn').disabled = true;
}

document.addEventListener('DOMContentLoaded', () => {
    initializeLandingPage();
    checkExistingUser();
    
    // Model preset buttons
    document.querySelectorAll('.model-preset').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.getElementById('modelInput').value = e.target.dataset.model;
        });
    });
});

function setupDragAndDrop() {
    const quadrants = document.querySelectorAll('.quadrant');
    
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
        const response = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.href,
                'X-Title': 'Day Planner'
            },
            body: JSON.stringify({
                model: currentModel,
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
            const newTasks = JSON.parse(jsonMatch[0]);
            const brainDumpId = generateBrainDumpId();
            
            // Convert task strings to task objects with brain dump references
            const convertTasksToObjects = (taskArray) => {
                return (taskArray || []).map(taskText => createTaskObject(taskText, brainDumpId));
            };
            
            // Add new tasks to existing ones instead of replacing
            currentTasks.triggers = [...currentTasks.triggers, ...convertTasksToObjects(newTasks.triggers)];
            currentTasks.marinate = [...currentTasks.marinate, ...convertTasksToObjects(newTasks.marinate)];
            currentTasks.deepwork = [...currentTasks.deepwork, ...convertTasksToObjects(newTasks.deepwork)];
            currentTasks.quickwins = [...currentTasks.quickwins, ...convertTasksToObjects(newTasks.quickwins)];
            
            displayQuadrants(currentTasks);
            saveTasks();
            saveLog(input, newTasks, brainDumpId);
            // Clear the input for next brain dump
            document.getElementById('brainDumpInput').value = '';
        }
    } catch (error) {
        console.error('Error organizing tasks:', error);
        alert('Error organizing tasks. Please try again.');
    } finally {
        showLoading(false);
    }
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
    e.dataTransfer.dropEffect = 'move';
    
    // Clear all existing drag-over highlights
    document.querySelectorAll('.task-item.drag-over').forEach(item => {
        item.classList.remove('drag-over');
    });
    document.querySelectorAll('.quadrant.drag-over').forEach(quad => {
        quad.classList.remove('drag-over');
    });
    
    // Find the closest quadrant and task item
    const quadrant = e.target.closest('.quadrant');
    const taskItem = e.target.closest('.task-item');
    
    if (quadrant) {
        quadrant.classList.add('drag-over');
        
        // If hovering over a specific task item, show insertion point
        if (taskItem && !taskItem.classList.contains('dragging')) {
            const rect = taskItem.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            
            if (e.clientY < midpoint) {
                taskItem.classList.add('drag-over-above');
                taskItem.classList.remove('drag-over-below');
            } else {
                taskItem.classList.add('drag-over-below');
                taskItem.classList.remove('drag-over-above');
            }
        }
    }
}

function handleDragEnter(e) {
    e.preventDefault();
}

function handleDragLeave(e) {
    // Only clear highlights when leaving the quadrant entirely
    if (e.target.classList.contains('quadrant') && !e.target.contains(e.relatedTarget)) {
        e.target.classList.remove('drag-over');
        document.querySelectorAll('.task-item.drag-over-above, .task-item.drag-over-below').forEach(item => {
            item.classList.remove('drag-over-above', 'drag-over-below');
        });
    }
}

function handleDrop(e) {
    e.preventDefault();
    
    // Clear all visual indicators
    document.querySelectorAll('.quadrant.drag-over').forEach(quad => {
        quad.classList.remove('drag-over');
    });
    document.querySelectorAll('.task-item.drag-over-above, .task-item.drag-over-below').forEach(item => {
        item.classList.remove('drag-over-above', 'drag-over-below');
    });
    
    const dropZone = e.target.closest('.quadrant');
    if (!dropZone || !draggedTask) return;
    
    const targetQuadrant = dropZone.id.replace('quadrant', '').replace('1', 'triggers').replace('2', 'marinate').replace('3', 'deepwork').replace('4', 'quickwins');
    const taskText = currentTasks[draggedFromQuadrant][draggedIndex];
    
    // Check if dropping on a specific task for precise positioning
    const targetTask = e.target.closest('.task-item');
    
    if (targetQuadrant === draggedFromQuadrant && targetTask && !targetTask.classList.contains('dragging')) {
        // Reordering within same quadrant with precise positioning
        const targetIndex = parseInt(targetTask.dataset.index);
        if (targetIndex !== draggedIndex) {
            const rect = targetTask.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const dropAbove = e.clientY < midpoint;
            
            // Remove from old position
            currentTasks[draggedFromQuadrant].splice(draggedIndex, 1);
            
            // Calculate new index based on drop position
            let newIndex = targetIndex;
            if (draggedIndex < targetIndex) {
                // Moving down: if dropping below target, insert after; if above, insert before
                newIndex = dropAbove ? targetIndex - 1 : targetIndex;
            } else {
                // Moving up: if dropping above target, insert before; if below, insert after
                newIndex = dropAbove ? targetIndex : targetIndex + 1;
            }
            
            // Ensure index is within bounds
            newIndex = Math.max(0, Math.min(currentTasks[draggedFromQuadrant].length, newIndex));
            
            currentTasks[draggedFromQuadrant].splice(newIndex, 0, taskText);
            displayTaskList(`${draggedFromQuadrant}-list`, currentTasks[draggedFromQuadrant], draggedFromQuadrant);
            saveTasks();
        }
    } else if (targetQuadrant !== draggedFromQuadrant) {
        // Moving between quadrants
        currentTasks[draggedFromQuadrant].splice(draggedIndex, 1);
        
        // If dropping on a specific task in different quadrant, insert at that position
        if (targetTask) {
            const targetIndex = parseInt(targetTask.dataset.index);
            const rect = targetTask.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const dropAbove = e.clientY < midpoint;
            const insertIndex = dropAbove ? targetIndex : targetIndex + 1;
            currentTasks[targetQuadrant].splice(insertIndex, 0, taskText);
        } else {
            // Dropping in empty area, add to end
            currentTasks[targetQuadrant].push(taskText);
        }
        
        displayTaskList(`${draggedFromQuadrant}-list`, currentTasks[draggedFromQuadrant], draggedFromQuadrant);
        displayTaskList(`${targetQuadrant}-list`, currentTasks[targetQuadrant], targetQuadrant);
        saveTasks();
    }
    
    draggedTask = null;
    draggedFromQuadrant = null;
    draggedIndex = null;
}

function displayQuadrants(tasks) {
    document.querySelector('.brain-dump-section').style.display = 'none';
    document.querySelector('.quadrants-section').style.display = 'block';
    
    displayTaskList('triggers-list', tasks.triggers || [], 'triggers');
    displayTaskList('marinate-list', tasks.marinate || [], 'marinate');
    displayTaskList('deepwork-list', tasks.deepwork || [], 'deepwork');
    displayTaskList('quickwins-list', tasks.quickwins || [], 'quickwins');
}

function showQuadrants() {
    document.querySelector('.brain-dump-section').style.display = 'none';
    document.querySelector('.quadrants-section').style.display = 'block';
    displayQuadrants(currentTasks);
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
        
        const taskText = getTaskText(task);
        li.innerHTML = `
            <input type="checkbox" id="${listId}-${index}" onchange="toggleTask('${listId}', ${index}, '${quadrantKey}')">
            <span class="task-text" onclick="editTaskInline('${quadrantKey}', ${index}, this)" title="Click to edit">${taskText}</span>
            <button class="brainstorm-btn" onclick="openBrainstormModal('${quadrantKey}', ${index})" title="AI Brainstorm">🧠</button>
            <button class="delete-btn" onclick="deleteTask('${quadrantKey}', ${index})" title="Delete">×</button>
        `;
        
        li.addEventListener('dragstart', handleDragStart);
        li.addEventListener('dragend', handleDragEnd);
        li.addEventListener('dragover', handleDragOver);
        li.addEventListener('drop', handleDrop);
        li.addEventListener('dragenter', handleDragEnter);
        li.addEventListener('dragleave', handleDragLeave);
        
        list.appendChild(li);
    });
}

function editTaskInline(quadrantKey, index, element) {
    const task = currentTasks[quadrantKey][index];
    const currentText = getTaskText(task);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentText;
    input.className = 'inline-edit-input';
    
    const saveEdit = () => {
        const newText = input.value.trim();
        if (newText && newText !== currentText) {
            // Update the task text while preserving other properties
            if (typeof task === 'object') {
                currentTasks[quadrantKey][index].text = newText;
            } else {
                // Convert old string format to new object format
                currentTasks[quadrantKey][index] = createTaskObject(newText, null);
            }
            displayTaskList(`${quadrantKey}-list`, currentTasks[quadrantKey], quadrantKey);
            saveTasks();
        } else {
            element.textContent = currentText;
            element.style.display = 'inline';
        }
        input.remove();
    };
    
    const cancelEdit = () => {
        element.textContent = currentText;
        element.style.display = 'inline';
        input.remove();
    };
    
    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            saveEdit();
        } else if (e.key === 'Escape') {
            cancelEdit();
        }
    });
    
    element.style.display = 'none';
    element.parentNode.insertBefore(input, element.nextSibling);
    input.focus();
    input.select();
}

function deleteTask(quadrantKey, index) {
    if (confirm('Delete this task?')) {
        currentTasks[quadrantKey].splice(index, 1);
        displayTaskList(`${quadrantKey}-list`, currentTasks[quadrantKey], quadrantKey);
        saveTasks();
    }
}

function toggleTask(listId, index, quadrantKey) {
    const checkbox = document.getElementById(`${listId}-${index}`);
    const taskItem = checkbox.parentElement;
    
    if (checkbox.checked) {
        taskItem.classList.add('completed');
        const task = currentTasks[quadrantKey][index];
        const taskText = getTaskText(task);
        saveCompletedTask(taskText, quadrantKey);
        
        setTimeout(() => {
            currentTasks[quadrantKey].splice(index, 1);
            displayTaskList(listId, currentTasks[quadrantKey], quadrantKey);
            saveTasks();
        }, 500);
    }
}

function saveCompletedTask(task, quadrant) {
    const completed = JSON.parse(getUserData('completedTasks') || '[]');
    const today = new Date().toISOString().split('T')[0];
    
    completed.push({
        id: Date.now(), // Add unique ID for undo functionality
        task: task,
        quadrant: quadrant,
        date: today,
        timestamp: new Date().toISOString()
    });
    
    setUserData('completedTasks', JSON.stringify(completed));
}

function loadCompletedTasks() {
    const completed = JSON.parse(getUserData('completedTasks') || '[]');
    const grouped = {};
    
    completed.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    completed.forEach(item => {
        if (!grouped[item.date]) {
            grouped[item.date] = [];
        }
        grouped[item.date].push(item);
    });
    
    const container = document.getElementById('completedTasksList');
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
            taskDiv.innerHTML = `
                <span class="completed-text">✓ ${item.task}</span>
                <button class="undo-btn" onclick="undoCompletedTask(${item.id})" title="Move back to ${getQuadrantName(item.quadrant)}">↶</button>
            `;
            dayGroup.appendChild(taskDiv);
        });
        
        container.appendChild(dayGroup);
    });
}

function getQuadrantName(quadrant) {
    const names = {
        triggers: 'Set in Motion',
        marinate: 'Marinate',
        deepwork: 'Deep Work',
        quickwins: 'Quick Wins'
    };
    return names[quadrant] || quadrant;
}

function undoCompletedTask(taskId) {
    const completed = JSON.parse(getUserData('completedTasks') || '[]');
    const taskIndex = completed.findIndex(item => item.id === taskId);
    
    if (taskIndex === -1) {
        alert('Task not found');
        return;
    }
    
    const task = completed[taskIndex];
    
    // Add back to the original quadrant
    currentTasks[task.quadrant].push(task.task);
    
    // Remove from completed tasks
    completed.splice(taskIndex, 1);
    setUserData('completedTasks', JSON.stringify(completed));
    
    // Update displays
    saveTasks();
    loadCompletedTasks();
    
    // If we're currently viewing quadrants, refresh them
    if (document.querySelector('.quadrants-section').style.display !== 'none') {
        displayQuadrants(currentTasks);
    }
    
    // Show success message
    const quadrantName = getQuadrantName(task.quadrant);
    alert(`Task moved back to ${quadrantName}`);
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
    setUserData('currentTasks', JSON.stringify(currentTasks));
    setUserData('lastUpdated', new Date().toISOString());
}

function loadSavedTasks() {
    const saved = getUserData('currentTasks');
    if (saved) {
        currentTasks = JSON.parse(saved);
        if (hasActiveTasks()) {
            displayQuadrants(currentTasks);
        }
    }
}

function hasActiveTasks() {
    return Object.values(currentTasks).some(tasks => tasks.length > 0);
}


function printTasks() {
    if (!hasActiveTasks()) {
        alert('No tasks to print! Add some tasks first.');
        return;
    }
    
    // Create a new window with a standalone document
    const printWindow = window.open('', '_blank');
    
    // Helper function to escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Generate the HTML content with inline styles
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>BrainSort Tasks - ${new Date().toLocaleDateString()}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        @page {
            size: letter;
            margin: 0.4in;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 11px;
            line-height: 1.3;
            color: #000;
            padding: 0;
            margin: 0;
        }
        
        .container {
            width: 100%;
            max-width: 7.5in;
            margin: 0 auto;
        }
        
        .header {
            text-align: center;
            border-bottom: 2px solid #333;
            padding-bottom: 8px;
            margin-bottom: 12px;
        }
        
        .header h1 {
            font-size: 20px;
            margin-bottom: 4px;
            color: #333;
        }
        
        .header .info {
            font-size: 10px;
            color: #666;
        }
        
        .quadrants {
            display: grid;
            grid-template-columns: 1fr 1fr;
            grid-template-rows: auto auto;
            gap: 12px;
            margin-bottom: 12px;
        }
        
        .quadrant {
            border: 1px solid #ccc;
            border-radius: 4px;
            padding: 8px;
            min-height: 3in;
            max-height: 3.8in;
            overflow: hidden;
        }
        
        .quadrant h2 {
            font-size: 13px;
            font-weight: bold;
            border-bottom: 1px solid #ddd;
            padding-bottom: 3px;
            margin-bottom: 3px;
        }
        
        .quadrant .desc {
            font-size: 9px;
            color: #666;
            font-style: italic;
            margin-bottom: 6px;
        }
        
        .quadrant ul {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        
        .quadrant li {
            font-size: 10px;
            padding: 2px 0 2px 12px;
            position: relative;
            color: #333;
        }
        
        .quadrant li:before {
            content: "☐";
            position: absolute;
            left: 0;
            top: 2px;
            font-size: 9px;
        }
        
        .quadrant li.empty {
            color: #999;
            font-style: italic;
        }
        
        .quadrant li.empty:before {
            content: "";
        }
        
        .footer {
            text-align: center;
            font-size: 9px;
            color: #999;
            border-top: 1px solid #ddd;
            padding-top: 8px;
            margin-top: 8px;
        }
        
        @media print {
            body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>BrainSort - Task List</h1>
            <div class="info">
                ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                ${currentUser ? ` • ${currentUser}` : ''}
            </div>
        </div>
        
        <div class="quadrants">
            <div class="quadrant">
                <h2>🚀 Set in Motion</h2>
                <div class="desc">2-5 minute tasks that unblock next steps</div>
                <ul>
                    ${(currentTasks.triggers || []).length === 0 
                        ? '<li class="empty">No tasks in this quadrant</li>'
                        : (currentTasks.triggers || []).map(task => `<li>${escapeHtml(task)}</li>`).join('')
                    }
                </ul>
            </div>
            
            <div class="quadrant">
                <h2>🧠 Marinate</h2>
                <div class="desc">Ideas to jot down and let simmer</div>
                <ul>
                    ${(currentTasks.marinate || []).length === 0
                        ? '<li class="empty">No tasks in this quadrant</li>'
                        : (currentTasks.marinate || []).map(task => `<li>${escapeHtml(task)}</li>`).join('')
                    }
                </ul>
            </div>
            
            <div class="quadrant">
                <h2>🎯 Deep Work</h2>
                <div class="desc">Tasks requiring extended focus</div>
                <ul>
                    ${(currentTasks.deepwork || []).length === 0
                        ? '<li class="empty">No tasks in this quadrant</li>'
                        : (currentTasks.deepwork || []).map(task => `<li>${escapeHtml(task)}</li>`).join('')
                    }
                </ul>
            </div>
            
            <div class="quadrant">
                <h2>✅ Quick Wins</h2>
                <div class="desc">Short tasks for momentum</div>
                <ul>
                    ${(currentTasks.quickwins || []).length === 0
                        ? '<li class="empty">No tasks in this quadrant</li>'
                        : (currentTasks.quickwins || []).map(task => `<li>${escapeHtml(task)}</li>`).join('')
                    }
                </ul>
            </div>
        </div>
        
        <div class="footer">
            BrainSort - Dump the chaos, let it fall into place.
        </div>
    </div>
</body>
</html>`;
    
    // Write the content to the new window
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    
    // Trigger print dialog after a short delay
    setTimeout(() => {
        printWindow.print();
    }, 250);
}

function cleanSlate() {
    if (confirm('⚠️ WARNING: This will permanently delete your task data:\n\n• All current tasks in all quadrants\n• All completed task history\n• All brain dump history and sessions\n\n✅ Your custom brainstorm templates will be preserved.\n\nThis action cannot be undone. Are you sure you want to proceed?')) {
        currentTasks = {
            triggers: [],
            marinate: [],
            deepwork: [],
            quickwins: []
        };
        
        // Clear completed tasks
        removeUserData('completedTasks');
        
        // Clear brain dump history
        removeUserData('brainDumpLogs');
        
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
    
    const taskObject = createTaskObject(taskText, null); // No brain dump ID for manual tasks
    currentTasks[quadrant].push(taskObject);
    displayTaskList(`${quadrant}-list`, currentTasks[quadrant], quadrant);
    saveTasks();
    hideManualAddModal();
}

function exportLog() {
    const logs = JSON.parse(getUserData('brainDumpLogs') || '[]');
    
    const dataStr = JSON.stringify(logs, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `braindump-logs-${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
}

function saveLog(brainDump, tasks, brainDumpId) {
    const logs = JSON.parse(getUserData('brainDumpLogs') || '[]');
    logs.push({
        id: brainDumpId,
        timestamp: new Date().toISOString(),
        brainDump: brainDump,
        categorizedTasks: tasks
    });
    setUserData('brainDumpLogs', JSON.stringify(logs));
}

function showModelModal() {
    document.getElementById('currentModel').textContent = currentModel;
    document.getElementById('modelInput').value = '';
    
    // Show masked API key
    const apiKeyInput = document.getElementById('apiKeyInput');
    if (OPENROUTER_API_KEY && OPENROUTER_API_KEY.length > 10) {
        apiKeyInput.placeholder = `Current: ${OPENROUTER_API_KEY.substring(0, 8)}...${OPENROUTER_API_KEY.slice(-4)}`;
    } else {
        apiKeyInput.placeholder = 'Enter your OpenRouter API key';
    }
    apiKeyInput.value = '';
    
    document.getElementById('modelModal').style.display = 'flex';
    document.getElementById('modelInput').focus();
}

function hideModelModal() {
    document.getElementById('modelModal').style.display = 'none';
}

function updateApiKey() {
    const newApiKey = document.getElementById('apiKeyInput').value.trim();
    
    if (!newApiKey) {
        alert('Please enter an API key');
        return;
    }
    
    if (!newApiKey.startsWith('sk-or-')) {
        if (!confirm('The API key doesn\'t appear to be a valid OpenRouter key (should start with "sk-or-"). Continue anyway?')) {
            return;
        }
    }
    
    OPENROUTER_API_KEY = newApiKey;
    localStorage.setItem('openrouter_api_key', newApiKey);
    
    // Update the placeholder to show the new masked key
    const apiKeyInput = document.getElementById('apiKeyInput');
    apiKeyInput.placeholder = `Current: ${OPENROUTER_API_KEY.substring(0, 8)}...${OPENROUTER_API_KEY.slice(-4)}`;
    apiKeyInput.value = '';
    
    alert('API key updated successfully!');
}

function showBrainDumpHistory() {
    const historyContent = document.getElementById('historyContent');
    const historyCount = document.getElementById('historyCount');
    
    const logs = JSON.parse(getUserData('brainDumpLogs') || '[]');
    
    historyCount.textContent = `${logs.length} brain dump${logs.length !== 1 ? 's' : ''}`;
    
    if (logs.length === 0) {
        historyContent.innerHTML = `
            <div class="history-empty">
                <h2>No brain dumps yet!</h2>
                <p>Start by creating your first brain dump to see your history here.</p>
                <button onclick="showView('braindump')" class="nav-btn">Start Brain Dump →</button>
            </div>
        `;
    } else {
        historyContent.innerHTML = logs.reverse().map((log, index) => {
            const date = new Date(log.timestamp);
            const formattedDate = date.toLocaleDateString() + ' at ' + date.toLocaleTimeString();
            
            return `
                <div class="history-entry" data-index="${index}">
                    <div class="history-date">${formattedDate}</div>
                    <div class="history-brain-dump">
                        <div class="brain-dump-full">${log.brainDump}</div>
                    </div>
                    <div class="history-categorization">
                        <h4>How it was organized:</h4>
                        <div class="categorization-grid">
                            <div class="category-section">
                                <div class="category-header">🚀 Set in Motion</div>
                                <ul>${log.categorizedTasks.triggers.map(task => `<li>${task}</li>`).join('')}</ul>
                            </div>
                            <div class="category-section">
                                <div class="category-header">🧠 Marinate</div>
                                <ul>${log.categorizedTasks.marinate.map(task => `<li>${task}</li>`).join('')}</ul>
                            </div>
                            <div class="category-section">
                                <div class="category-header">🎯 Deep Work</div>
                                <ul>${log.categorizedTasks.deepwork.map(task => `<li>${task}</li>`).join('')}</ul>
                            </div>
                            <div class="category-section">
                                <div class="category-header">✅ Quick Wins</div>
                                <ul>${log.categorizedTasks.quickwins.map(task => `<li>${task}</li>`).join('')}</ul>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
}


function filterBrainDumpHistory() {
    const searchTerm = document.getElementById('historySearch').value.toLowerCase();
    const entries = document.querySelectorAll('.history-entry');
    
    entries.forEach(entry => {
        const brainDumpText = entry.querySelector('.brain-dump-full').textContent.toLowerCase();
        const categorizationText = entry.querySelector('.history-categorization').textContent.toLowerCase();
        
        if (brainDumpText.includes(searchTerm) || categorizationText.includes(searchTerm)) {
            entry.style.display = 'block';
        } else {
            entry.style.display = 'none';
        }
    });
}

function saveModel() {
    const newModel = document.getElementById('modelInput').value.trim();
    
    if (!newModel) {
        alert('Please enter a model name');
        return;
    }
    
    // Basic validation for model format
    if (!newModel.includes('/')) {
        alert('Model should be in format: provider/model-name (e.g., openai/gpt-4o)');
        return;
    }
    
    currentModel = newModel;
    setUserData('selectedModel', currentModel);
    document.getElementById('currentModel').textContent = currentModel;
    
    hideModelModal();
    alert(`Model updated to: ${currentModel}`);
}

function showView(view) {
    const plannerView = document.getElementById('plannerView');
    const completedHistoryView = document.getElementById('historyView');
    const brainDumpHistoryView = document.querySelector('#historyView.history-page');
    const brainDumpSection = document.querySelector('.brain-dump-section');
    const quadrantsSection = document.querySelector('.quadrants-section');
    const mainApp = document.getElementById('mainApp');
    
    const templatesView = document.getElementById('templatesView');
    const brainDumpBtn = document.getElementById('brainDumpBtn');
    const quadrantsBtn = document.getElementById('quadrantsBtn');
    const historyBtn = document.getElementById('historyBtn');
    const brainDumpHistoryBtn = document.getElementById('brainDumpHistoryBtn');
    const templatesBtn = document.getElementById('templatesBtn');
    
    // Remove active class from all buttons
    brainDumpBtn?.classList.remove('active');
    quadrantsBtn?.classList.remove('active');
    historyBtn?.classList.remove('active');
    brainDumpHistoryBtn?.classList.remove('active');
    templatesBtn?.classList.remove('active');
    
    if (view === 'braindump') {
        plannerView.style.display = 'block';
        completedHistoryView.style.display = 'none';
        if (brainDumpHistoryView) brainDumpHistoryView.style.display = 'none';
        if (templatesView) templatesView.style.display = 'none';
        brainDumpSection.style.display = 'block';
        quadrantsSection.style.display = 'none';
        mainApp.style.display = 'block';
        brainDumpBtn?.classList.add('active');
        // Keep the input clear for new additions
        document.getElementById('brainDumpInput').value = '';
    } else if (view === 'quadrants') {
        plannerView.style.display = 'block';
        completedHistoryView.style.display = 'none';
        if (brainDumpHistoryView) brainDumpHistoryView.style.display = 'none';
        if (templatesView) templatesView.style.display = 'none';
        brainDumpSection.style.display = 'none';
        quadrantsSection.style.display = 'block';
        mainApp.style.display = 'block';
        quadrantsBtn?.classList.add('active');
        
        if (!hasActiveTasks()) {
            alert('No tasks yet! Start with a brain dump to add some tasks.');
            showView('braindump');
        }
    } else if (view === 'history') {
        plannerView.style.display = 'none';
        completedHistoryView.style.display = 'block';
        if (brainDumpHistoryView) brainDumpHistoryView.style.display = 'none';
        if (templatesView) templatesView.style.display = 'none';
        mainApp.style.display = 'block';
        historyBtn?.classList.add('active');
        loadCompletedTasks();
    } else if (view === 'brainhistory') {
        mainApp.style.display = 'none';
        if (brainDumpHistoryView) brainDumpHistoryView.style.display = 'block';
        if (templatesView) templatesView.style.display = 'none';
        brainDumpHistoryBtn?.classList.add('active');
        
        // Update the user display in history view
        const currentUserDisplayHistory = document.getElementById('currentUserDisplayHistory');
        if (currentUserDisplayHistory && currentUser) {
            currentUserDisplayHistory.textContent = `User: ${currentUser}`;
        }
        
        showBrainDumpHistory();
    } else if (view === 'templates') {
        mainApp.style.display = 'none';
        plannerView.style.display = 'none';
        completedHistoryView.style.display = 'none';
        if (brainDumpHistoryView) brainDumpHistoryView.style.display = 'none';
        if (templatesView) templatesView.style.display = 'block';
        templatesBtn?.classList.add('active');
        
        // Update the user display in templates view
        const currentUserDisplayTemplates = document.getElementById('currentUserDisplayTemplates');
        if (currentUserDisplayTemplates && currentUser) {
            currentUserDisplayTemplates.textContent = `User: ${currentUser}`;
        }
        
        showTemplates();
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

// Template CRUD Functions
let editingTemplateId = null;

function showTemplates() {
    const templatesContent = document.getElementById('templatesContent');
    const templatesCount = document.getElementById('templatesCount');
    const templates = getAllTemplates();
    
    templatesCount.textContent = `${templates.length} template${templates.length !== 1 ? 's' : ''}`;
    
    if (templates.length === 0) {
        templatesContent.innerHTML = `
            <div class="templates-empty">
                <p>No templates yet! Create your first custom template to streamline your brainstorming.</p>
                <button class="create-template-cta">Create Your First Template</button>
            </div>
        `;
        // Re-attach event listener for the CTA button
        document.querySelector('.create-template-cta')?.addEventListener('click', showTemplateModal);
    } else {
        templatesContent.innerHTML = `
            <div class="templates-grid">
                ${templates.map(template => `
                    <div class="template-card" data-template-id="${template.id}">
                        <div class="template-header">
                            <h3 class="template-name">${escapeHtml(template.name)}</h3>
                            <div class="template-actions">
                                <button class="template-edit-btn" onclick="editTemplate('${template.id}')" title="Edit">✏️</button>
                                <button class="template-delete-btn" onclick="confirmDeleteTemplate('${template.id}')" title="Delete">🗑️</button>
                            </div>
                        </div>
                        <p class="template-description">${escapeHtml(template.description)}</p>
                        <div class="template-meta">
                            <div class="template-tags">
                                ${template.tags.map(tag => `<span class="template-tag">${escapeHtml(tag)}</span>`).join('')}
                            </div>
                            <div class="template-stats">
                                <span class="template-use-count">Used ${template.useCount} time${template.useCount !== 1 ? 's' : ''}</span>
                                ${template.lastUsed ? `<span class="template-last-used">Last used: ${new Date(template.lastUsed).toLocaleDateString()}</span>` : ''}
                            </div>
                        </div>
                        <div class="template-prompt-preview">
                            <p>${escapeHtml(template.prompt.length > 100 ? template.prompt.substring(0, 100) + '...' : template.prompt)}</p>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }
}

function showTemplateModal(templateId = null) {
    editingTemplateId = templateId;
    const modal = document.getElementById('templateModal');
    const modalTitle = document.getElementById('templateModalTitle');
    const templateName = document.getElementById('templateName');
    const templateDescription = document.getElementById('templateDescription');
    const templateTags = document.getElementById('templateTags');
    const templatePrompt = document.getElementById('templatePrompt');
    
    if (templateId) {
        const template = getTemplate(templateId);
        if (template) {
            modalTitle.textContent = 'Edit Template';
            templateName.value = template.name;
            templateDescription.value = template.description;
            templateTags.value = template.tags.join(', ');
            templatePrompt.value = template.prompt;
        }
    } else {
        modalTitle.textContent = 'Create New Template';
        templateName.value = '';
        templateDescription.value = '';
        templateTags.value = '';
        templatePrompt.value = '';
    }
    
    modal.style.display = 'flex';
    templateName.focus();
}

function hideTemplateModal() {
    document.getElementById('templateModal').style.display = 'none';
    editingTemplateId = null;
}

function saveTemplate() {
    console.log('saveTemplate function called');
    
    const templateName = document.getElementById('templateName')?.value?.trim();
    const templateDescription = document.getElementById('templateDescription')?.value?.trim();
    const templateTags = document.getElementById('templateTags')?.value?.split(',').map(tag => tag.trim()).filter(tag => tag);
    const templatePrompt = document.getElementById('templatePrompt')?.value?.trim();
    
    console.log('Template data:', { templateName, templateDescription, templateTags, templatePrompt });
    
    if (!templateName || !templatePrompt) {
        alert('Please provide at least a name and prompt for the template.');
        return;
    }
    
    if (editingTemplateId) {
        // Update existing template
        updateTemplate(editingTemplateId, {
            name: templateName,
            description: templateDescription,
            tags: templateTags,
            prompt: templatePrompt
        });
    } else {
        // Create new template
        createTemplate(templateName, templateDescription, templatePrompt, templateTags);
    }
    
    hideTemplateModal();
    showTemplates();
    console.log('Template saved successfully. Total templates:', brainstormTemplates.length);
}

function editTemplate(templateId) {
    showTemplateModal(templateId);
}

function confirmDeleteTemplate(templateId) {
    const template = getTemplate(templateId);
    if (template && confirm(`Are you sure you want to delete "${template.name}"?`)) {
        deleteTemplate(templateId);
        showTemplates();
    }
}

function filterTemplates() {
    const query = document.getElementById('templatesSearch').value.trim();
    const templates = query ? searchTemplates(query) : getAllTemplates();
    
    const templatesContent = document.getElementById('templatesContent');
    const templatesCount = document.getElementById('templatesCount');
    
    templatesCount.textContent = `${templates.length} template${templates.length !== 1 ? 's' : ''} ${query ? `matching "${query}"` : ''}`;
    
    if (templates.length === 0 && query) {
        templatesContent.innerHTML = `
            <div class="templates-empty">
                <p>No templates match your search "${query}".</p>
                <button onclick="document.getElementById('templatesSearch').value = ''; filterTemplates()">Clear Search</button>
            </div>
        `;
    } else if (templates.length === 0) {
        showTemplates(); // Show the default empty state
    } else {
        templatesContent.innerHTML = `
            <div class="templates-grid">
                ${templates.map(template => `
                    <div class="template-card" data-template-id="${template.id}">
                        <div class="template-header">
                            <h3 class="template-name">${escapeHtml(template.name)}</h3>
                            <div class="template-actions">
                                <button class="template-edit-btn" onclick="editTemplate('${template.id}')" title="Edit">✏️</button>
                                <button class="template-delete-btn" onclick="confirmDeleteTemplate('${template.id}')" title="Delete">🗑️</button>
                            </div>
                        </div>
                        <p class="template-description">${escapeHtml(template.description)}</p>
                        <div class="template-meta">
                            <div class="template-tags">
                                ${template.tags.map(tag => `<span class="template-tag">${escapeHtml(tag)}</span>`).join('')}
                            </div>
                            <div class="template-stats">
                                <span class="template-use-count">Used ${template.useCount} time${template.useCount !== 1 ? 's' : ''}</span>
                                ${template.lastUsed ? `<span class="template-last-used">Last used: ${new Date(template.lastUsed).toLocaleDateString()}</span>` : ''}
                            </div>
                        </div>
                        <div class="template-prompt-preview">
                            <p>${escapeHtml(template.prompt.length > 100 ? template.prompt.substring(0, 100) + '...' : template.prompt)}</p>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Brainstorm Modal Functions
let currentBrainstormTask = null;
let currentBrainstormQuadrant = null;
let brainstormConversation = [];
let selectedTemplateContext = null;

function openBrainstormModal(quadrantKey, taskIndex) {
    const task = currentTasks[quadrantKey][taskIndex];
    if (!task) return;
    
    const taskText = getTaskText(task);
    const brainDumpId = getTaskBrainDumpId(task);
    
    // Open brainstorm session in new tab
    const params = new URLSearchParams({
        user: currentUser,
        taskName: taskText,
        quadrant: quadrantKey,
        model: currentModel
    });
    
    // Add brain dump ID if available
    if (brainDumpId) {
        params.set('brainDumpId', brainDumpId);
    }
    
    const brainstormUrl = `brainstorm.html?${params.toString()}`;
    window.open(brainstormUrl, '_blank');
}

// Brainstorm modal functions removed - now opens in new tab

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        // Brief visual feedback
        const button = event.target;
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        setTimeout(() => {
            button.textContent = originalText;
        }, 1000);
    }).catch(err => {
        console.error('Failed to copy text:', err);
        alert('Failed to copy to clipboard');
    });
}

function copyAIContent(text) {
    // Remove "AI:" prefix and any leading whitespace
    let cleanText = text;
    if (cleanText.startsWith('AI:')) {
        cleanText = cleanText.substring(3).trim();
    }
    
    navigator.clipboard.writeText(cleanText).then(() => {
        // Brief visual feedback
        const button = event.target;
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        setTimeout(() => {
            button.textContent = originalText;
        }, 1000);
    }).catch(err => {
        console.error('Failed to copy text:', err);
        alert('Failed to copy to clipboard');
    });
}

// Template Import/Export Functions
function exportTemplates() {
    const templates = getAllTemplates();
    
    if (templates.length === 0) {
        alert('No templates to export! Create some templates first.');
        return;
    }
    
    const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        user: currentUser,
        templates: templates
    };
    
    const dataStr = JSON.stringify(exportData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `brainsort-templates-${currentUser}-${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    
    alert(`Exported ${templates.length} template${templates.length !== 1 ? 's' : ''} successfully!`);
}

function importTemplates() {
    const fileInput = document.getElementById('templateImportInput');
    if (fileInput) {
        fileInput.click();
    }
}

function handleTemplateImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.name.toLowerCase().endsWith('.json')) {
        alert('Please select a JSON file.');
        event.target.value = '';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importData = JSON.parse(e.target.result);
            
            // Validate the import data structure
            if (!importData.templates || !Array.isArray(importData.templates)) {
                throw new Error('Invalid template file format. Missing templates array.');
            }
            
            // Validate each template has required fields
            const requiredFields = ['name', 'prompt'];
            for (let template of importData.templates) {
                for (let field of requiredFields) {
                    if (!template[field] || typeof template[field] !== 'string') {
                        throw new Error(`Invalid template: missing or invalid '${field}' field.`);
                    }
                }
            }
            
            // Show import preview/confirmation
            const importCount = importData.templates.length;
            const existingCount = brainstormTemplates.length;
            
            const confirmMessage = `Import ${importCount} template${importCount !== 1 ? 's' : ''} from file?\n\n` +
                `This will add them to your existing ${existingCount} template${existingCount !== 1 ? 's' : ''}.\n\n` +
                `Templates with duplicate names will be imported with a suffix.`;
            
            if (!confirm(confirmMessage)) {
                event.target.value = '';
                return;
            }
            
            // Import the templates
            let importedCount = 0;
            let duplicateCount = 0;
            
            for (let templateData of importData.templates) {
                // Check for duplicate names and modify if necessary
                let templateName = templateData.name;
                let originalName = templateName;
                let counter = 1;
                
                while (brainstormTemplates.some(t => t.name === templateName)) {
                    templateName = `${originalName} (${counter})`;
                    counter++;
                    duplicateCount++;
                }
                
                // Create the template with potentially modified name
                createTemplate(
                    templateName,
                    templateData.description || '',
                    templateData.prompt,
                    templateData.tags || []
                );
                
                importedCount++;
            }
            
            // Refresh the templates display
            if (document.getElementById('templatesView').style.display === 'block') {
                showTemplates();
            }
            
            // Show success message
            let message = `Successfully imported ${importedCount} template${importedCount !== 1 ? 's' : ''}!`;
            if (duplicateCount > 0) {
                message += `\n\n${duplicateCount} template${duplicateCount !== 1 ? 's' : ''} had duplicate names and were renamed.`;
            }
            alert(message);
            
        } catch (error) {
            console.error('Template import error:', error);
            alert(`Failed to import templates: ${error.message}`);
        }
        
        // Clear the file input
        event.target.value = '';
    };
    
    reader.onerror = function() {
        alert('Failed to read the file. Please try again.');
        event.target.value = '';
    };
    
    reader.readAsText(file);
}