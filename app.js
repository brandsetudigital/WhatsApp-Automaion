// Client-side Application Script for WhatsApp Automation Dashboard

document.addEventListener('DOMContentLoaded', () => {
  // Socket.io Connection Setup
  const socket = io();

  // App State Variables
  let loadedContacts = [];
  let detectedColumns = [];
  let isCampaignRunning = false;

  // DOM Elements
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const logoutBtn = document.getElementById('logoutBtn');
  const checkHealthBtn = document.getElementById('checkHealthBtn');
  const metaStatusTitle = document.getElementById('metaStatusTitle');
  const metaStatusDesc = document.getElementById('metaStatusDesc');
  const metaPhoneIdVal = document.getElementById('metaPhoneIdVal');
  const metaDisplayPhoneVal = document.getElementById('metaDisplayPhoneVal');
  const metaAccountNameVal = document.getElementById('metaAccountNameVal');
  const webhookUrlCode = document.getElementById('webhookUrlCode');

  // Set default webhook helper text
  if (webhookUrlCode) {
    webhookUrlCode.textContent = `${window.location.origin}/api/whatsapp/webhook`;
  }

  // Broadcast DOM Elements
  const csvFileInput = document.getElementById('csvFileInput');
  const dropZone = document.getElementById('dropZone');
  const fileNameDisplay = document.getElementById('fileNameDisplay');
  const manualNumbers = document.getElementById('manualNumbers');
  const recipientCount = document.getElementById('recipientCount');
  const tagsContainer = document.getElementById('tagsContainer');
  const tagsList = document.getElementById('tagsList');
  const messageTemplate = document.getElementById('messageTemplate');
  const mediaAttachment = document.getElementById('mediaAttachment');
  const minDelayInput = document.getElementById('minDelay');
  const maxDelayInput = document.getElementById('maxDelay');
  const startCampaignBtn = document.getElementById('startCampaignBtn');
  const stopCampaignBtn = document.getElementById('stopCampaignBtn');

  // Auto-Reply DOM Elements
  const autoReplyForm = document.getElementById('autoReplyForm');
  const botTriggerInput = document.getElementById('botTrigger');
  const botMatchTypeSelect = document.getElementById('botMatchType');
  const botReplyTextInput = document.getElementById('botReplyText');
  const botAttachmentInput = document.getElementById('botAttachment');
  const botRulesTable = document.getElementById('botRulesTable');

  // Log & Progress DOM Elements
  const terminalConsole = document.getElementById('terminalConsole');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  const progressBarFill = document.getElementById('progressBarFill');
  const progressPercent = document.getElementById('progressPercent');
  const statTotal = document.getElementById('statTotal');
  const statSent = document.getElementById('statSent');
  const statFailed = document.getElementById('statFailed');

  // ==========================================
  // 1. Sidebar Tab Navigation Logic
  // ==========================================
  const navItems = document.querySelectorAll('.nav-item');
  const tabPanes = document.querySelectorAll('.tab-pane');

  function switchTab(tabId) {
    navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.tab === tabId);
    });
    tabPanes.forEach(pane => {
      pane.classList.toggle('active', pane.id === tabId);
    });
  }

  navItems.forEach(item => {
    item.addEventListener('click', () => switchTab(item.dataset.tab));
  });

  // ==========================================
  // 2. Real-Time Socket Event Listeners & Meta Status
  // ==========================================

  async function checkMetaStatus() {
    try {
      const res = await fetch('/api/whatsapp/status');
      const data = await res.json();
      updateMetaStatusUI(data);
    } catch (err) {
      console.error('Error fetching Meta API status:', err);
      updateMetaStatusUI({ status: 'error', message: err.message });
    }
  }

  function updateMetaStatusUI(data) {
    const status = data.status || 'disconnected';
    statusBadge.className = `status-badge status-${status}`;

    if (status === 'connected') {
      statusText.textContent = 'Meta API Connected';
      if (metaStatusTitle) metaStatusTitle.textContent = 'Meta WhatsApp Cloud API Connected';
      if (metaStatusDesc) metaStatusDesc.textContent = 'Official Meta Graph API active & ready for messaging.';
      if (metaPhoneIdVal) metaPhoneIdVal.textContent = data.phoneNumberId || 'Configured';
      if (metaDisplayPhoneVal) metaDisplayPhoneVal.textContent = data.displayPhoneNumber || 'Active';
      if (metaAccountNameVal) metaAccountNameVal.textContent = data.verifiedName || 'WhatsApp Account';
    } else if (status === 'not_configured') {
      statusText.textContent = 'Not Configured';
      if (metaStatusTitle) metaStatusTitle.textContent = 'Meta Credentials Missing';
      if (metaStatusDesc) metaStatusDesc.textContent = 'Please configure WHATSAPP_ACCESS_TOKEN & WHATSAPP_PHONE_NUMBER_ID in .env file.';
      if (metaPhoneIdVal) metaPhoneIdVal.textContent = 'Not Set';
      if (metaDisplayPhoneVal) metaDisplayPhoneVal.textContent = '--';
      if (metaAccountNameVal) metaAccountNameVal.textContent = '--';
    } else if (status === 'error') {
      statusText.textContent = 'API Error';
      if (metaStatusTitle) metaStatusTitle.textContent = 'Meta API Connection Error';
      if (metaStatusDesc) metaStatusDesc.textContent = data.message || 'Error authenticating with Meta API.';
      if (metaPhoneIdVal) metaPhoneIdVal.textContent = data.phoneNumberId || 'Error';
    } else {
      statusText.textContent = 'Disconnected';
      if (metaStatusTitle) metaStatusTitle.textContent = 'Disconnected';
      if (metaStatusDesc) metaStatusDesc.textContent = 'Status unknown or disconnected.';
    }
  }

  // Socket status update
  socket.on('status-update', (data) => {
    updateMetaStatusUI(data);
  });

  if (checkHealthBtn) {
    checkHealthBtn.addEventListener('click', checkMetaStatus);
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', checkMetaStatus);
  }

  // Check initial Meta status
  checkMetaStatus();

  // Console Logs
  socket.on('log', (logData) => {
    appendLog(logData.type, logData.text);
  });

  // Progress Update
  socket.on('campaign-progress', (data) => {
    isCampaignRunning = data.running;
    statTotal.textContent = data.total || 0;
    statSent.textContent = data.sent || 0;
    statFailed.textContent = data.failed || 0;

    const percent = data.total > 0 ? Math.round(((data.sent + data.failed) / data.total) * 100) : 0;
    progressBarFill.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;

    if (isCampaignRunning) {
      startCampaignBtn.style.display = 'none';
      stopCampaignBtn.style.display = 'block';
    } else {
      startCampaignBtn.style.display = 'block';
      stopCampaignBtn.style.display = 'none';
    }
  });

  function appendLog(type, text) {
    const time = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = `log-entry log-${type}`;
    div.textContent = `[${time}] ${text}`;
    terminalConsole.appendChild(div);
    terminalConsole.scrollTop = terminalConsole.scrollHeight;
  }

  clearLogsBtn.addEventListener('click', () => {
    terminalConsole.innerHTML = '<div class="log-entry log-info">[Console Cleared]</div>';
  });

  // Logout Handler
  logoutBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to disconnect your WhatsApp account?')) {
      try {
        const res = await fetch('/api/logout', { method: 'POST' });
        const result = await res.json();
        if (result.success) {
          appendLog('warning', 'Disconnected WhatsApp session.');
        }
      } catch (err) {
        alert('Error logging out: ' + err.message);
      }
    }
  });

  // ==========================================
  // 3. File Upload & CSV/Excel Contact Parsing
  // ==========================================

  // Dropzone drag & drop
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, false);
  });

  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      csvFileInput.files = files;
      handleFileUpload(files[0]);
    }
  });

  csvFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  });

  async function handleFileUpload(file) {
    fileNameDisplay.textContent = `📄 Selected: ${file.name}`;
    const formData = new FormData();
    formData.append('file', file);

    try {
      appendLog('info', `Uploading and parsing file: ${file.name}...`);
      const response = await fetch('/api/upload-csv', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();

      if (data.success) {
        loadedContacts = data.contacts;
        detectedColumns = data.columns;
        updateRecipientCounter();
        renderTagPills();
        appendLog('success', `Successfully loaded ${data.count} contacts from ${file.name}`);
      } else {
        alert('Error: ' + data.error);
        appendLog('error', `Failed to parse file: ${data.error}`);
      }
    } catch (err) {
      alert('Upload failed: ' + err.message);
      appendLog('error', `Upload error: ${err.message}`);
    }
  }

  // Manual phone number text area changes
  manualNumbers.addEventListener('input', () => {
    if (!csvFileInput.files || csvFileInput.files.length === 0) {
      updateRecipientCounter();
    }
  });

  function getManualNumbersArray() {
    const text = manualNumbers.value.trim();
    if (!text) return [];
    return text.split('\n').map(num => num.trim()).filter(num => num.length >= 8);
  }

  function updateRecipientCounter() {
    if (loadedContacts.length > 0) {
      recipientCount.textContent = loadedContacts.length;
    } else {
      const manualList = getManualNumbersArray();
      recipientCount.textContent = manualList.length;
    }
  }

  function renderTagPills() {
    tagsList.innerHTML = '';
    if (detectedColumns.length > 0) {
      tagsContainer.style.display = 'block';
      detectedColumns.forEach(col => {
        const pill = document.createElement('span');
        pill.className = 'tag-pill';
        pill.textContent = `{${col}}`;
        pill.title = 'Click to insert tag into message';
        pill.addEventListener('click', () => {
          insertTagIntoTemplate(`{${col}}`);
        });
        tagsList.appendChild(pill);
      });
    } else {
      tagsContainer.style.display = 'none';
    }
  }

  function insertTagIntoTemplate(tag) {
    const cursorPos = messageTemplate.selectionStart;
    const textBefore = messageTemplate.value.substring(0, cursorPos);
    const textAfter = messageTemplate.value.substring(cursorPos);
    messageTemplate.value = textBefore + tag + textAfter;
    messageTemplate.focus();
    messageTemplate.selectionStart = cursorPos + tag.length;
    messageTemplate.selectionEnd = cursorPos + tag.length;
  }

  // ==========================================
  // 4. Launch & Stop Bulk Campaign
  // ==========================================
  startCampaignBtn.addEventListener('click', async () => {
    let recipients = [];
    if (loadedContacts.length > 0) {
      recipients = loadedContacts;
    } else {
      const manualList = getManualNumbersArray();
      recipients = manualList.map(num => ({ phone: num }));
    }

    if (recipients.length === 0) {
      alert('Please upload a CSV file or enter phone numbers.');
      return;
    }

    const templateText = messageTemplate.value.trim();
    if (!templateText) {
      alert('Please enter a message template.');
      return;
    }

    const formData = new FormData();
    formData.append('recipients', JSON.stringify(recipients));
    formData.append('templateText', templateText);
    formData.append('minDelay', minDelayInput.value);
    formData.append('maxDelay', maxDelayInput.value);

    if (mediaAttachment.files.length > 0) {
      formData.append('media', mediaAttachment.files[0]);
    }

    try {
      startCampaignBtn.disabled = true;
      const response = await fetch('/api/send-bulk', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();

      if (data.success) {
        switchTab('tab-logs'); // Auto switch to Live Logs tab
        appendLog('info', `Campaign started for ${data.total} recipients!`);
      } else {
        alert('Failed to start campaign: ' + data.error);
        appendLog('error', `Campaign error: ${data.error}`);
      }
    } catch (err) {
      alert('Network error: ' + err.message);
    } finally {
      startCampaignBtn.disabled = false;
    }
  });

  stopCampaignBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to stop the current campaign?')) {
      try {
        const res = await fetch('/api/stop-campaign', { method: 'POST' });
        const result = await res.json();
        if (result.success) {
          appendLog('warning', 'Stop signal sent to server.');
        }
      } catch (err) {
        alert('Error stopping campaign: ' + err.message);
      }
    }
  });

  // ==========================================
  // 5. Auto-Reply Bot Rules Engine
  // ==========================================
  async function loadAutoReplyRules() {
    try {
      const res = await fetch('/api/auto-replies');
      const data = await res.json();
      if (data.success) {
        renderRulesTable(data.rules);
      }
    } catch (err) {
      console.error('Error loading bot rules:', err);
    }
  }

  function renderRulesTable(rules) {
    if (!rules || rules.length === 0) {
      botRulesTable.innerHTML = '<tr><td colspan="4" class="text-center">No auto-reply rules added yet.</td></tr>';
      return;
    }

    botRulesTable.innerHTML = rules.map(rule => `
      <tr>
        <td><strong>"${escapeHtml(rule.trigger)}"</strong></td>
        <td><span class="badge badge-success">${rule.matchType}</span></td>
        <td>${escapeHtml(rule.replyText.substring(0, 40))}${rule.replyText.length > 40 ? '...' : ''}</td>
        <td>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteBotRule('${rule.id}')">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');
  }

  autoReplyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('trigger', botTriggerInput.value);
    formData.append('matchType', botMatchTypeSelect.value);
    formData.append('replyText', botReplyTextInput.value);

    if (botAttachmentInput.files.length > 0) {
      formData.append('attachment', botAttachmentInput.files[0]);
    }

    try {
      const res = await fetch('/api/auto-replies', {
        method: 'POST',
        body: formData
      });
      const result = await res.json();
      if (result.success) {
        autoReplyForm.reset();
        loadAutoReplyRules();
        appendLog('success', `Created new auto-reply rule for "${result.rule.trigger}"`);
      } else {
        alert('Error saving rule: ' + result.error);
      }
    } catch (err) {
      alert('Error saving rule: ' + err.message);
    }
  });

  window.deleteBotRule = async function(id) {
    if (confirm('Delete this auto-reply rule?')) {
      try {
        const res = await fetch(`/api/auto-replies/${id}`, { method: 'DELETE' });
        const result = await res.json();
        if (result.success) {
          loadAutoReplyRules();
          appendLog('info', 'Deleted auto-reply rule.');
        }
      } catch (err) {
        alert('Error deleting rule: ' + err.message);
      }
    }
  };

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, function(m) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }[m];
    });
  }

  // ==========================================
  // 6. AI Chatbot Studio & Simulator Handlers
  // ==========================================
  const aiEnabledToggle = document.getElementById('aiEnabledToggle');
  const aiToggleText = document.getElementById('aiToggleText');
  const aiConfigForm = document.getElementById('aiConfigForm');
  const aiProviderSelect = document.getElementById('aiProvider');
  const aiApiKeyInput = document.getElementById('aiApiKey');
  const aiBusinessNameInput = document.getElementById('aiBusinessName');
  const aiBusinessDescInput = document.getElementById('aiBusinessDesc');
  const aiKnowledgeBaseInput = document.getElementById('aiKnowledgeBase');
  const aiSystemPromptInput = document.getElementById('aiSystemPrompt');

  const simChatBox = document.getElementById('simChatBox');
  const simUserInput = document.getElementById('simUserInput');
  const simSendBtn = document.getElementById('simSendBtn');

  async function loadAiConfig() {
    try {
      const res = await fetch('/api/ai-config');
      const data = await res.json();
      if (data.success && data.config) {
        const c = data.config;
        aiEnabledToggle.checked = !!c.enabled;
        updateAiToggleText(c.enabled);
        if (c.provider) aiProviderSelect.value = c.provider;
        if (c.apiKeyMasked) aiApiKeyInput.value = '••••••••';
        if (c.businessName) aiBusinessNameInput.value = c.businessName;
        if (c.businessDescription) aiBusinessDescInput.value = c.businessDescription;
        if (c.knowledgeBase) aiKnowledgeBaseInput.value = c.knowledgeBase;
        if (c.systemPrompt) aiSystemPromptInput.value = c.systemPrompt;
      }
    } catch (err) {
      console.error('Error loading AI config:', err);
    }
  }

  aiEnabledToggle.addEventListener('change', () => {
    updateAiToggleText(aiEnabledToggle.checked);
  });

  function updateAiToggleText(enabled) {
    aiToggleText.textContent = enabled ? 'AI Auto-Reply ON' : 'AI Auto-Reply OFF';
    aiToggleText.style.color = enabled ? 'var(--wa-green)' : 'var(--danger)';
  }

  aiConfigForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      enabled: aiEnabledToggle.checked,
      provider: aiProviderSelect.value,
      apiKey: aiApiKeyInput.value,
      businessName: aiBusinessNameInput.value,
      businessDescription: aiBusinessDescInput.value,
      knowledgeBase: aiKnowledgeBaseInput.value,
      systemPrompt: aiSystemPromptInput.value
    };

    try {
      const res = await fetch('/api/ai-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (result.success) {
        appendLog('success', 'Saved AI Chatbot Knowledge Base & Settings!');
        alert('AI Chatbot Configuration Saved!');
      } else {
        alert('Error saving AI config: ' + result.error);
      }
    } catch (err) {
      alert('Error saving AI config: ' + err.message);
    }
  });

  // Simulator Test Action
  async function runSimTest() {
    const text = simUserInput.value.trim();
    if (!text) return;

    appendSimMsg('user', text);
    simUserInput.value = '';

    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'chat-msg chat-msg-bot';
    loadingDiv.innerHTML = `
      <div class="chat-avatar"><i class="fa-solid fa-robot"></i></div>
      <div class="chat-bubble"><em>Thinking AI response...</em></div>
    `;
    simChatBox.appendChild(loadingDiv);
    simChatBox.scrollTop = simChatBox.scrollHeight;

    try {
      const res = await fetch('/api/ai-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      const data = await res.json();
      simChatBox.removeChild(loadingDiv);

      if (data.success && data.aiResponse) {
        appendSimMsg('bot', data.aiResponse);
      } else {
        appendSimMsg('bot', 'Error generating response: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      simChatBox.removeChild(loadingDiv);
      appendSimMsg('bot', 'Network error: ' + err.message);
    }
  }

  function appendSimMsg(sender, messageText) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg chat-msg-${sender}`;
    const icon = sender === 'bot' ? '<i class="fa-solid fa-robot"></i>' : '<i class="fa-solid fa-user"></i>';

    msgDiv.innerHTML = `
      <div class="chat-avatar">${icon}</div>
      <div class="chat-bubble">${escapeHtml(messageText)}</div>
    `;
    simChatBox.appendChild(msgDiv);
    simChatBox.scrollTop = simChatBox.scrollHeight;
  }

  simSendBtn.addEventListener('click', runSimTest);
  simUserInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') runSimTest();
  });

  // ==========================================
  // 6. Hiring & Candidates CRM Logic
  // ==========================================
  let candidatesList = [];
  let currentCandidateFilter = 'all';

  const kpiTotal = document.getElementById('kpiTotal');
  const kpiPending = document.getElementById('kpiPending');
  const kpiToday = document.getElementById('kpiToday');
  const kpiScheduled = document.getElementById('kpiScheduled');

  const countAll = document.getElementById('countAll');
  const countPending = document.getElementById('countPending');
  const countScheduled = document.getElementById('countScheduled');
  const countCompleted = document.getElementById('countCompleted');

  const candidatesTableBody = document.getElementById('candidatesTableBody');
  const candidateSearchInput = document.getElementById('candidateSearchInput');
  const refreshHiringBtn = document.getElementById('refreshHiringBtn');
  const filterPills = document.querySelectorAll('.filter-pills .pill-btn');

  // Modals
  const scheduleModal = document.getElementById('scheduleModal');
  const scheduleForm = document.getElementById('scheduleForm');
  const scheduleCandidateId = document.getElementById('scheduleCandidateId');
  const scheduleCandidateInfo = document.getElementById('scheduleCandidateInfo');
  const scheduleRole = document.getElementById('scheduleRole');
  const scheduleDateTime = document.getElementById('scheduleDateTime');
  const scheduleNotes = document.getElementById('scheduleNotes');
  const scheduleSendWhatsApp = document.getElementById('scheduleSendWhatsApp');
  const closeScheduleModal = document.getElementById('closeScheduleModal');
  const cancelScheduleBtn = document.getElementById('cancelScheduleBtn');

  const addCandidateBtn = document.getElementById('addCandidateBtn');
  const addCandidateModal = document.getElementById('addCandidateModal');
  const addCandidateForm = document.getElementById('addCandidateForm');
  const closeAddCandidateModal = document.getElementById('closeAddCandidateModal');
  const cancelAddCandBtn = document.getElementById('cancelAddCandBtn');

  async function loadCandidates() {
    try {
      const res = await fetch('/api/hiring/candidates');
      const data = await res.json();
      if (data.success) {
        candidatesList = data.candidates || [];
        updateHiringStatsUI(data.stats || {});
        renderCandidatesTable();
      }
    } catch (err) {
      console.error('Error fetching candidates:', err);
      if (candidatesTableBody) {
        candidatesTableBody.innerHTML = `
          <tr>
            <td colspan="7" class="text-center py-4 text-danger">
              <i class="fa-solid fa-triangle-exclamation me-2"></i> Failed to load candidates data.
            </td>
          </tr>
        `;
      }
    }
  }

  function updateHiringStatsUI(stats) {
    if (kpiTotal) kpiTotal.textContent = stats.total || candidatesList.length;
    if (kpiPending) kpiPending.textContent = stats.resumePending || 0;
    if (kpiToday) kpiToday.textContent = stats.scheduledToday || 0;
    if (kpiScheduled) kpiScheduled.textContent = stats.interviewScheduled || 0;

    if (countAll) countAll.textContent = candidatesList.length;
    if (countPending) countPending.textContent = candidatesList.filter(c => !c.resumeReceived).length;
    if (countScheduled) countScheduled.textContent = candidatesList.filter(c => c.status === 'Interview Scheduled').length;
    if (countCompleted) countCompleted.textContent = candidatesList.filter(c => c.status === 'Completed' || c.status === 'Selected').length;
  }

  function renderCandidatesTable() {
    if (!candidatesTableBody) return;

    const searchTerm = (candidateSearchInput?.value || '').toLowerCase().trim();

    let filtered = candidatesList.filter(c => {
      // 1. Search Query Filter
      const matchSearch = (
        (c.name || '').toLowerCase().includes(searchTerm) ||
        (c.phone || '').toLowerCase().includes(searchTerm) ||
        (c.role || '').toLowerCase().includes(searchTerm) ||
        (c.notes || '').toLowerCase().includes(searchTerm)
      );
      if (!matchSearch) return false;

      // 2. Tab Filter
      if (currentCandidateFilter === 'pending') return !c.resumeReceived;
      if (currentCandidateFilter === 'scheduled') return c.status === 'Interview Scheduled';
      if (currentCandidateFilter === 'completed') return (c.status === 'Completed' || c.status === 'Selected');
      return true; // 'all'
    });

    if (filtered.length === 0) {
      candidatesTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center py-5 text-muted">
            <i class="fa-solid fa-inbox fa-2x mb-2 d-block"></i>
            Koi candidate nahi mila. Ads se aane wale WhatsApp messages automatically yahan list ho jayenge.
          </td>
        </tr>
      `;
      return;
    }

    candidatesTableBody.innerHTML = filtered.map(c => {
      // Role Badge
      let roleClass = 'badge-role-general';
      if ((c.role || '').toLowerCase().includes('seo')) roleClass = 'badge-role-seo';
      else if ((c.role || '').toLowerCase().includes('video')) roleClass = 'badge-role-video';

      // Resume Badge
      let resumeBadge = c.resumeReceived
        ? `<span class="badge-status badge-status-received"><i class="fa-solid fa-check"></i> Received</span>`
        : `<span class="badge-status badge-status-pending"><i class="fa-solid fa-clock"></i> Missing</span>`;

      let portfolioBtn = c.portfolio
        ? `<a href="${c.portfolio}" target="_blank" class="btn-icon-action mt-1" style="font-size:0.72rem;"><i class="fa-solid fa-arrow-up-right-from-square"></i> View Work</a>`
        : '';

      // Interview Date & Time
      let interviewText = '<span class="text-muted">Not Scheduled</span>';
      if (c.interviewDateTime) {
        try {
          const d = new Date(c.interviewDateTime);
          const formatted = d.toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short'
          });
          interviewText = `<strong class="text-white">${formatted}</strong>`;
        } catch (e) {
          interviewText = c.interviewDateTime;
        }
      }

      // Status Badge
      let statusClass = 'badge-status-pending';
      if (c.status === 'Interview Scheduled') statusClass = 'badge-status-scheduled';
      else if (c.status === 'Resume Received') statusClass = 'badge-status-received';
      else if (c.status === 'Completed' || c.status === 'Selected') statusClass = 'badge-status-completed';

      // Reminders status
      let remindersInfo = [];
      if (c.resumeReminderSent) remindersInfo.push('<span title="4-hr Resume Reminder Sent" class="badge-status badge-status-pending" style="font-size:0.68rem;"><i class="fa-solid fa-bell"></i> Resume Reminder</span>');
      if (c.interviewReminderSent) remindersInfo.push('<span title="1-hr Interview Reminder Sent" class="badge-status badge-status-scheduled" style="font-size:0.68rem;"><i class="fa-solid fa-bell"></i> 1hr Alert Sent</span>');
      if (remindersInfo.length === 0) remindersInfo.push('<span class="text-dim" style="font-size:0.75rem;">None</span>');

      return `
        <tr>
          <td>
            <div class="cand-name">${escapeHtml(c.name || 'Candidate')}</div>
            <div class="cand-phone">+${escapeHtml(c.phone)}</div>
          </td>
          <td>
            <span class="badge-role ${roleClass}">${escapeHtml(c.role || 'General')}</span>
          </td>
          <td>
            <div>${resumeBadge}</div>
            ${portfolioBtn}
          </td>
          <td>
            ${interviewText}
            ${c.notes ? `<div class="text-dim" style="font-size:0.72rem; margin-top:2px;"><i class="fa-solid fa-note-sticky"></i> ${escapeHtml(c.notes)}</div>` : ''}
          </td>
          <td>
            <span class="badge-status ${statusClass}">${escapeHtml(c.status || 'Applied')}</span>
          </td>
          <td>
            ${remindersInfo.join('<br>')}
          </td>
          <td>
            <div class="flex gap-1">
              <button class="btn-icon-action schedule-cand-btn" data-id="${c.id}" title="Schedule Interview">
                <i class="fa-solid fa-calendar-days"></i> Schedule
              </button>
              ${!c.resumeReceived ? `
                <button class="btn-icon-action send-resume-reminder-btn" data-id="${c.id}" title="Send 4-hr Resume Reminder Now">
                  <i class="fa-solid fa-bell"></i>
                </button>
              ` : ''}
              ${c.status === 'Interview Scheduled' ? `
                <button class="btn-icon-action send-interview-reminder-btn" data-id="${c.id}" title="Send 1-hr Interview Reminder Now">
                  <i class="fa-solid fa-clock"></i>
                </button>
              ` : ''}
              <a href="https://wa.me/${c.phone}" target="_blank" class="btn-icon-action" title="Chat on WhatsApp">
                <i class="fa-brands fa-whatsapp text-success"></i>
              </a>
              <button class="btn-icon-action btn-icon-danger delete-cand-btn" data-id="${c.id}" title="Delete">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Attach row events
    attachCandidateRowEvents();
  }

  function attachCandidateRowEvents() {
    // Schedule button
    document.querySelectorAll('.schedule-cand-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const cand = candidatesList.find(c => c.id === id);
        if (!cand) return;

        scheduleCandidateId.value = cand.id;
        scheduleCandidateInfo.value = `${cand.name} (+${cand.phone})`;
        scheduleRole.value = (cand.role === 'SEO Expert' || cand.role === 'Video Editor') ? cand.role : 'SEO Expert';

        // Pre-fill tomorrow 11:00 AM if not scheduled
        if (cand.interviewDateTime) {
          const d = new Date(cand.interviewDateTime);
          d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
          scheduleDateTime.value = d.toISOString().slice(0, 16);
        } else {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(11, 0, 0, 0);
          tomorrow.setMinutes(tomorrow.getMinutes() - tomorrow.getTimezoneOffset());
          scheduleDateTime.value = tomorrow.toISOString().slice(0, 16);
        }
        scheduleNotes.value = cand.notes || '';
        scheduleModal.style.display = 'flex';
      });
    });

    // Send Resume Reminder button
    document.querySelectorAll('.send-resume-reminder-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!confirm('Kya aap candidate ko Resume Reminder bhejna chahte hain?')) return;
        try {
          const res = await fetch('/api/hiring/send-reminder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidateId: id, type: 'resume' })
          });
          const data = await res.json();
          if (data.success) {
            alert('Resume Reminder message sent to WhatsApp!');
            loadCandidates();
          } else {
            alert('Error: ' + data.error);
          }
        } catch (e) {
          alert('Network error: ' + e.message);
        }
      });
    });

    // Send 1-Hr Interview Reminder button
    document.querySelectorAll('.send-interview-reminder-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!confirm('Kya aap candidate ko Interview Reminder alert abhi bhejna chahte hain?')) return;
        try {
          const res = await fetch('/api/hiring/send-reminder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidateId: id, type: 'interview' })
          });
          const data = await res.json();
          if (data.success) {
            alert('Interview Reminder sent to candidate on WhatsApp!');
            loadCandidates();
          } else {
            alert('Error: ' + data.error);
          }
        } catch (e) {
          alert('Network error: ' + e.message);
        }
      });
    });

    // Delete Candidate button
    document.querySelectorAll('.delete-cand-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!confirm('Are you sure you want to delete this candidate?')) return;
        try {
          const res = await fetch(`/api/hiring/candidate/${id}`, { method: 'DELETE' });
          const data = await res.json();
          if (data.success) {
            loadCandidates();
          } else {
            alert('Error: ' + data.error);
          }
        } catch (e) {
          alert('Network error: ' + e.message);
        }
      });
    });
  }

  // Filter Pill buttons
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentCandidateFilter = pill.dataset.filter;
      renderCandidatesTable();
    });
  });

  if (candidateSearchInput) {
    candidateSearchInput.addEventListener('input', renderCandidatesTable);
  }

  if (refreshHiringBtn) {
    refreshHiringBtn.addEventListener('click', () => {
      loadCandidates();
      appendLog('info', 'Refreshed candidate pipeline data.');
    });
  }

  // Schedule Modal Event Listeners
  if (closeScheduleModal) closeScheduleModal.addEventListener('click', () => scheduleModal.style.display = 'none');
  if (cancelScheduleBtn) cancelScheduleBtn.addEventListener('click', () => scheduleModal.style.display = 'none');

  if (scheduleForm) {
    scheduleForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = scheduleCandidateId.value;
      const dateTime = scheduleDateTime.value;
      const role = scheduleRole.value;
      const notes = scheduleNotes.value.trim();
      const sendWhatsApp = scheduleSendWhatsApp.checked;

      if (!dateTime) {
        alert('Please select Interview Date & Time');
        return;
      }

      try {
        const res = await fetch('/api/hiring/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            candidateId: id,
            interviewDateTime: new Date(dateTime).toISOString(),
            role,
            notes,
            sendInstantConfirmation: sendWhatsApp
          })
        });

        const data = await res.json();
        if (data.success) {
          scheduleModal.style.display = 'none';
          alert('Interview scheduled successfully! WhatsApp confirmation has been dispatched.');
          loadCandidates();
        } else {
          alert('Error: ' + data.error);
        }
      } catch (err) {
        alert('Error scheduling interview: ' + err.message);
      }
    });
  }

  // Add Candidate Modal Event Listeners
  if (addCandidateBtn) {
    addCandidateBtn.addEventListener('click', () => {
      addCandidateForm.reset();
      addCandidateModal.style.display = 'flex';
    });
  }
  if (closeAddCandidateModal) closeAddCandidateModal.addEventListener('click', () => addCandidateModal.style.display = 'none');
  if (cancelAddCandBtn) cancelAddCandBtn.addEventListener('click', () => addCandidateModal.style.display = 'none');

  if (addCandidateForm) {
    addCandidateForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('newCandName').value.trim();
      const phone = document.getElementById('newCandPhone').value.trim();
      const role = document.getElementById('newCandRole').value;
      const portfolio = document.getElementById('newCandPortfolio').value.trim();
      const resumeStatus = document.getElementById('newCandResumeStatus').value === '1';

      if (!phone) {
        alert('Please enter WhatsApp phone number');
        return;
      }

      try {
        const res = await fetch('/api/hiring/candidate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            phone,
            role,
            portfolio,
            resumeReceived: resumeStatus
          })
        });

        const data = await res.json();
        if (data.success) {
          addCandidateModal.style.display = 'none';
          alert('Candidate added and synced to Excel successfully!');
          loadCandidates();
        } else {
          alert('Error: ' + data.error);
        }
      } catch (err) {
        alert('Error adding candidate: ' + err.message);
      }
    });
  }

  // Real-time Socket Event for Candidates Pipeline
  socket.on('hiring:update', (data) => {
    if (data && data.candidates) {
      candidatesList = data.candidates;
      updateHiringStatsUI(data.stats || {});
      renderCandidatesTable();
    }
  });

  // Initial Load Calls
  loadAutoReplyRules();
  loadAiConfig();
  loadCandidates();
});

