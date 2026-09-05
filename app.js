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
  const whatsappWebQrPanel = document.getElementById('whatsappWebQrPanel');
  const whatsappWebQr = document.getElementById('whatsappWebQr');

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

  // On mobile screens, activate WhatsApp Chats by default
  if (window.innerWidth <= 900) {
    switchTab('tab-chats');
  }

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

    if (data.provider === 'web') {
      statusText.textContent = status === 'connected' ? 'WhatsApp Web Connected' : 'WhatsApp Web ' + status;
      if (metaStatusTitle) metaStatusTitle.textContent = 'WhatsApp Web Browser Session';
      if (metaStatusDesc) metaStatusDesc.textContent = data.message || 'Use the QR code to link your WhatsApp account.';
      if (whatsappWebQrPanel) whatsappWebQrPanel.style.display = data.qr ? 'block' : 'none';
      if (whatsappWebQr && data.qr) whatsappWebQr.src = data.qr;
      return;
    }

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
        renderInboxConversationsList();
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

      // Resume Badge & Links
      let resumeBadge = c.resumeReceived
        ? `<span class="badge-status badge-status-received"><i class="fa-solid fa-check"></i> Received</span>`
        : `<span class="badge-status badge-status-pending"><i class="fa-solid fa-clock"></i> Missing</span>`;

      let resumePdfBtn = c.resumeUrl
        ? `<a href="${c.resumeUrl}" target="_blank" class="btn btn-sm btn-outline-primary mt-1 d-inline-block" style="font-size:0.72rem; padding: 2px 6px;"><i class="fa-solid fa-file-pdf"></i> Open PDF</a>`
        : '';

      let portfolioBtn = c.portfolio
        ? `<a href="${c.portfolio}" target="_blank" class="btn-icon-action mt-1 d-inline-block" style="font-size:0.72rem;"><i class="fa-solid fa-arrow-up-right-from-square"></i> View Work</a>`
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
            <div class="cand-name cand-name-clickable" data-id="${c.id}" title="Click to open WhatsApp Mobile Chat">
              <i class="fa-brands fa-whatsapp text-success me-1"></i> ${escapeHtml(c.name || 'Candidate')}
            </div>
            <div class="cand-phone">+${escapeHtml(c.phone)}</div>
          </td>
          <td>
            <span class="badge-role ${roleClass}">${escapeHtml(c.role || 'General')}</span>
          </td>
          <td>
            <div>${resumeBadge}</div>
            ${resumePdfBtn}
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
              <button class="btn-icon-action btn-view-chat open-chat-cand-btn" data-id="${c.id}" title="Open WhatsApp Mobile Chat">
                <i class="fa-brands fa-whatsapp"></i> Chat ${c.chatHistory && c.chatHistory.length ? `(${c.chatHistory.length})` : ''}
              </button>
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
    // Open WhatsApp Chat on candidate row button or name click
    document.querySelectorAll('.open-chat-cand-btn, .cand-name-clickable').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.dataset.id;
        openCandidateWhatsAppMobile(id);
      });
    });

    // Schedule button
    document.querySelectorAll('.schedule-cand-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const cand = candidatesList.find(c => c.id === id);
        if (!cand) return;

        scheduleCandidateId.value = cand.id;
        scheduleCandidateInfo.value = `${cand.name} (+${cand.phone})`;
        scheduleRole.value = cand.role || 'Video Editor';

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
      renderInboxConversationsList();
      if (activeMobileCandidateId) {
        const updated = candidatesList.find(c => c.id === activeMobileCandidateId);
        if (updated) renderCandidateWhatsAppChat(updated);
      }
      if (selectedInboxCandidateId) {
        const updated = candidatesList.find(c => c.id === selectedInboxCandidateId);
        if (updated) renderInboxChatStream(updated);
      }
    }
  });

  socket.on('hiring-updated', (data) => {
    if (data && data.candidates) {
      candidatesList = data.candidates;
      updateHiringStatsUI(data.stats || {});
      renderCandidatesTable();
      renderInboxConversationsList();
      if (activeMobileCandidateId) {
        const updated = candidatesList.find(c => c.id === activeMobileCandidateId);
        if (updated) {
          renderCandidateWhatsAppChat(updated);
          if (waChatCanvas) {
            waChatCanvas.scrollTop = waChatCanvas.scrollHeight;
          }
        }
      }
      if (selectedInboxCandidateId) {
        const updated = candidatesList.find(c => c.id === selectedInboxCandidateId);
        if (updated) {
          renderInboxChatStream(updated);
          if (inboxChatCanvas) {
            inboxChatCanvas.scrollTop = inboxChatCanvas.scrollHeight;
          }
        }
      }
    }
  });

  // =========================================================================
  // WhatsApp Mobile Screen Phone Simulator & Chat Viewer
  // =========================================================================
  let activeMobileCandidateId = null;

  const waMobileModal = document.getElementById('waMobileModal');
  const closeWaMobileBtn = document.getElementById('closeWaMobileBtn');
  const closeWaModalFloatingBtn = document.getElementById('closeWaModalFloatingBtn');
  const waPhoneChatStream = document.getElementById('waPhoneChatStream');
  const waChatCanvas = document.getElementById('waChatCanvas');
  const waPhoneInput = document.getElementById('waPhoneInput');
  const waPhoneSendBtn = document.getElementById('waPhoneSendBtn');
  const waPhoneAvatarChar = document.getElementById('waPhoneAvatarChar');
  const waPhoneCandName = document.getElementById('waPhoneCandName');
  const waPhoneCandRoleTag = document.getElementById('waPhoneCandRoleTag');
  const waPillResumeText = document.getElementById('waPillResumeText');
  const waPillInterviewText = document.getElementById('waPillInterviewText');
  const waPillPhoneText = document.getElementById('waPillPhoneText');
  const waPhoneClock = document.getElementById('waPhoneClock');
  const openMobilePreviewBtn = document.getElementById('openMobilePreviewBtn');
  const waHdrScheduleBtn = document.getElementById('waHdrScheduleBtn');
  const waHdrCallBtn = document.getElementById('waHdrCallBtn');

  function updatePhoneClock() {
    if (waPhoneClock) {
      const now = new Date();
      waPhoneClock.textContent = now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    }
  }
  updatePhoneClock();
  setInterval(updatePhoneClock, 30000);

  function closeWhatsAppMobile() {
    if (waMobileModal) {
      waMobileModal.style.display = 'none';
    }
    activeMobileCandidateId = null;
  }

  if (closeWaMobileBtn) closeWaMobileBtn.addEventListener('click', closeWhatsAppMobile);
  if (closeWaModalFloatingBtn) closeWaModalFloatingBtn.addEventListener('click', closeWhatsAppMobile);

  if (waMobileModal) {
    waMobileModal.addEventListener('click', (e) => {
      if (e.target === waMobileModal) {
        closeWhatsAppMobile();
      }
    });
  }

  // Header quick preview button
  if (openMobilePreviewBtn) {
    openMobilePreviewBtn.addEventListener('click', () => {
      if (!candidatesList || candidatesList.length === 0) {
        alert('Abhi koi candidate available nahi hai. Pehle ek candidate add karein ya WhatsApp par message receive hone dein.');
        return;
      }
      openCandidateWhatsAppMobile(candidatesList[0].id);
    });
  }

  // Header Call button -> open WhatsApp chat link
  if (waHdrCallBtn) {
    waHdrCallBtn.addEventListener('click', () => {
      if (!activeMobileCandidateId) return;
      const cand = candidatesList.find(c => c.id === activeMobileCandidateId);
      if (cand && cand.phone) {
        window.open(`https://wa.me/${cand.phone}`, '_blank');
      }
    });
  }

  // Header Schedule button -> open schedule modal
  if (waHdrScheduleBtn) {
    waHdrScheduleBtn.addEventListener('click', () => {
      if (!activeMobileCandidateId) return;
      const cand = candidatesList.find(c => c.id === activeMobileCandidateId);
      if (!cand) return;
      
      scheduleCandidateId.value = cand.id;
      scheduleCandidateInfo.value = `${cand.name} (+${cand.phone})`;
      scheduleRole.value = cand.role || 'Video Editor';

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
  }

  /**
   * Format message text with bold, italic, and URLs
   */
  function formatWhatsAppText(rawText) {
    if (!rawText) return '';
    let text = escapeHtml(rawText);

    // *bold* -> <strong>
    text = text.replace(/\*([^\*]+)\*/g, '<strong>$1</strong>');
    // _italic_ -> <em>
    text = text.replace(/_([^_]+)_/g, '<em>$1</em>');
    // ~strike~ -> <del>
    text = text.replace(/~([^~]+)~/g, '<del>$1</del>');

    // Auto linkify URLs
    text = text.replace(/(https?:\/\/[^\s<]+)/gi, (url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#53bdeb; text-decoration:underline;">${url}</a>`;
    });

    return text;
  }

  /**
   * Format message timestamp into "11:03 AM"
   */
  function formatTime(isoString) {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch (e) {
      return '';
    }
  }

  /**
   * Open WhatsApp Mobile Simulator for a specific candidate
   */
  function openCandidateWhatsAppMobile(candidateId) {
    const candidate = candidatesList.find(c => c.id === candidateId);
    if (!candidate) return;

    activeMobileCandidateId = candidate.id;
    updatePhoneClock();

    // Populate Header & Info
    const displayName = candidate.name || 'Candidate';
    if (waPhoneCandName) waPhoneCandName.textContent = displayName;
    if (waPhoneAvatarChar) {
      const firstChar = displayName.trim().charAt(0).toUpperCase() || 'C';
      waPhoneAvatarChar.textContent = firstChar;
    }
    if (waPhoneCandRoleTag) {
      waPhoneCandRoleTag.textContent = candidate.role || 'Applicant';
    }

    // Populate Summary Bar
    if (waPillResumeText) {
      waPillResumeText.textContent = candidate.resumeReceived ? 'Resume Received' : 'Resume Pending';
    }
    if (waPillInterviewText) {
      if (candidate.interviewDateTime) {
        try {
          const d = new Date(candidate.interviewDateTime);
          waPillInterviewText.textContent = 'Interview: ' + d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        } catch (e) {
          waPillInterviewText.textContent = 'Interview: Scheduled';
        }
      } else {
        waPillInterviewText.textContent = 'Interview: Not Set';
      }
    }
    if (waPillPhoneText) {
      waPillPhoneText.textContent = `+${candidate.phone}`;
    }

    // Render Conversation Bubbles
    renderCandidateWhatsAppChat(candidate);

    // Show Modal
    if (waMobileModal) {
      waMobileModal.style.display = 'flex';
    }

    // Auto scroll chat to bottom
    setTimeout(() => {
      if (waChatCanvas) {
        waChatCanvas.scrollTop = waChatCanvas.scrollHeight;
      }
      if (waPhoneInput) {
        waPhoneInput.focus();
      }
    }, 50);
  }

  /**
   * Render candidate conversation bubbles into mobile phone screen
   */
  function renderCandidateWhatsAppChat(candidate) {
    if (!waPhoneChatStream) return;

    const history = candidate.chatHistory || [];

    if (history.length === 0) {
      waPhoneChatStream.innerHTML = `
        <div class="wa-msg-row incoming">
          <div class="wa-bubble incoming">
            <div class="wa-bubble-sender">${escapeHtml(candidate.name || 'Candidate')}</div>
            <div class="wa-bubble-text">Hii, I am applying for ${escapeHtml(candidate.role || 'job opening')}.</div>
            <div class="wa-bubble-meta">
              <span class="wa-bubble-time">${formatTime(candidate.createdAt || new Date().toISOString())}</span>
            </div>
          </div>
        </div>
      `;
      return;
    }

    let html = '';
    history.forEach((msg) => {
      const isUser = msg.role === 'user';
      const rowClass = isUser ? 'incoming' : 'outgoing';
      const bubbleClass = isUser ? 'incoming' : 'outgoing';
      const senderLabel = isUser ? escapeHtml(candidate.name || 'Candidate') : 'BrandSetu HR';
      const timeStr = formatTime(msg.timestamp);

      // Check if message is a document attachment
      let docCardHtml = '';
      const text = String(msg.text || '').trim();
      if (text.includes('[Document received]') || text.toLowerCase().includes('.pdf') || (candidate.resumeUrl && isUser && text.toLowerCase().includes('resume'))) {
        const docName = candidate.resumeFileName || 'Resume_Document.pdf';
        const docUrl = candidate.resumeUrl || candidate.portfolio || '#';
        docCardHtml = `
          <a href="${docUrl}" target="_blank" class="wa-doc-attachment">
            <div class="wa-doc-icon"><i class="fa-solid fa-file-pdf"></i></div>
            <div class="wa-doc-info">
              <div class="wa-doc-title">${escapeHtml(docName)}</div>
              <div class="wa-doc-sub">PDF Document • Tap to View</div>
            </div>
            <div class="wa-doc-download"><i class="fa-solid fa-download"></i></div>
          </a>
        `;
      }

      html += `
        <div class="wa-msg-row ${rowClass}">
          <div class="wa-bubble ${bubbleClass}">
            <div class="wa-bubble-sender">${senderLabel}</div>
            ${docCardHtml}
            <div class="wa-bubble-text">${formatWhatsAppText(msg.text)}</div>
            <div class="wa-bubble-meta">
              <span class="wa-bubble-time">${timeStr}</span>
              ${!isUser ? '<span class="wa-double-ticks" title="Delivered & Read">✓✓</span>' : ''}
            </div>
          </div>
        </div>
      `;
    });

    waPhoneChatStream.innerHTML = html;
  }

  /**
   * Send WhatsApp Message from Mobile Phone Simulator
   */
  async function sendCandidateWhatsAppMessage() {
    if (!activeMobileCandidateId) return;
    const inputVal = (waPhoneInput?.value || '').trim();
    if (!inputVal) return;

    const cand = candidatesList.find(c => c.id === activeMobileCandidateId);
    if (!cand) return;

    // Optimistically append outgoing bubble immediately
    if (!cand.chatHistory) cand.chatHistory = [];
    const newMsg = {
      role: 'assistant',
      text: inputVal,
      timestamp: new Date().toISOString()
    };
    cand.chatHistory.push(newMsg);
    renderCandidateWhatsAppChat(cand);
    
    if (waChatCanvas) {
      waChatCanvas.scrollTop = waChatCanvas.scrollHeight;
    }

    if (waPhoneInput) waPhoneInput.value = '';

    // Dispatch API
    try {
      const res = await fetch('/api/hiring/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateId: cand.id,
          message: inputVal
        })
      });

      const data = await res.json();
      if (!data.success) {
        alert('Could not send message via WhatsApp: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Error sending candidate message:', err);
    }
  }

  if (waPhoneSendBtn) {
    waPhoneSendBtn.addEventListener('click', sendCandidateWhatsAppMessage);
  }

  if (waPhoneInput) {
    waPhoneInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendCandidateWhatsAppMessage();
      }
    });
  }

  // Quick Action Chips in Mobile Simulator
  document.querySelectorAll('.wa-quick-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      if (!activeMobileCandidateId) return;
      const cand = candidatesList.find(c => c.id === activeMobileCandidateId);
      if (!cand) return;

      const template = chip.dataset.template;
      let textToSend = '';

      if (template === 'address') {
        textToSend = `📍 *BrandSetu Digital Office Address:*\n103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Transport Nagar, Indore (M.P.) - 452014\n\nGoogle Maps: https://maps.google.com/?q=Orange+Business+Park+Indore`;
      } else if (template === 'resume') {
        textToSend = `Hello ${cand.name || 'Candidate'}! 😊 Please share your updated *Resume (PDF)* or Portfolio/Drive link here so we can proceed with your application! 📄💼`;
      } else if (template === 'confirm') {
        textToSend = `Dear ${cand.name || 'Candidate'}! 🎉 Your in-person interview for the *${cand.role || 'Applied'}* position is confirmed at our Indore office (103 Orange Business Park, Bhawarkua). Best of luck! 👍`;
      } else if (template === 'reminder') {
        if (!confirm('Send 1-Hr Interview Reminder to this candidate?')) return;
        try {
          const res = await fetch('/api/hiring/send-reminder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidateId: cand.id, type: 'interview' })
          });
          const d = await res.json();
          if (d.success) {
            alert('1-Hr Interview Reminder sent!');
            loadCandidates();
          } else {
            alert('Error: ' + d.error);
          }
        } catch (e) {
          alert('Network error: ' + e.message);
        }
        return;
      }

      if (textToSend && waPhoneInput) {
        waPhoneInput.value = textToSend;
        waPhoneInput.focus();
      }
    });
  });

  // =========================================================================
  // WhatsApp Inbox & Multi-Conversation Live Chats Module
  // =========================================================================
  let selectedInboxCandidateId = null;
  let currentInboxFilter = 'all';

  const navChatCountBadge = document.getElementById('navChatCountBadge');
  const refreshInboxBtn = document.getElementById('refreshInboxBtn');
  const inboxPopMobileBtn = document.getElementById('inboxPopMobileBtn');
  const inboxSearchInput = document.getElementById('inboxSearchInput');
  const inboxConversationsList = document.getElementById('inboxConversationsList');
  const inboxEmptyState = document.getElementById('inboxEmptyState');
  const inboxActiveChat = document.getElementById('inboxActiveChat');
  const inboxBackToListBtn = document.getElementById('inboxBackToListBtn');

  // Active Chat Header Elements
  const inboxActiveAvatar = document.getElementById('inboxActiveAvatar');
  const inboxActiveName = document.getElementById('inboxActiveName');
  const inboxActiveRoleTag = document.getElementById('inboxActiveRoleTag');
  const inboxActivePhone = document.getElementById('inboxActivePhone');
  const inboxInfoResume = document.getElementById('inboxInfoResume');
  const inboxInfoInterview = document.getElementById('inboxInfoInterview');
  const inboxInfoStatus = document.getElementById('inboxInfoStatus');
  const inboxChatCanvas = document.getElementById('inboxChatCanvas');
  const inboxChatStream = document.getElementById('inboxChatStream');
  const inboxMessageInput = document.getElementById('inboxMessageInput');
  const inboxSendBtn = document.getElementById('inboxSendBtn');
  const inboxScheduleBtn = document.getElementById('inboxScheduleBtn');
  const inboxOpenMobileBtn = document.getElementById('inboxOpenMobileBtn');
  const inboxCallBtn = document.getElementById('inboxCallBtn');

  // Filter Pill Elements
  const inboxFilterAllCount = document.getElementById('inboxFilterAllCount');
  const inboxFilterMsgCount = document.getElementById('inboxFilterMsgCount');
  const inboxFilterSchedCount = document.getElementById('inboxFilterSchedCount');
  const inboxFilterResumeCount = document.getElementById('inboxFilterResumeCount');

  // Filter pill click listeners
  document.querySelectorAll('.inbox-filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.inbox-filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentInboxFilter = pill.dataset.filter;
      renderInboxConversationsList();
    });
  });

  if (inboxSearchInput) {
    inboxSearchInput.addEventListener('input', () => {
      renderInboxConversationsList();
    });
  }

  if (refreshInboxBtn) {
    refreshInboxBtn.addEventListener('click', () => {
      loadCandidates();
    });
  }

  if (inboxBackToListBtn) {
    inboxBackToListBtn.addEventListener('click', () => {
      const layout = document.querySelector('.wa-inbox-layout');
      if (layout) layout.classList.remove('show-chat');
    });
  }

  if (inboxPopMobileBtn) {
    inboxPopMobileBtn.addEventListener('click', () => {
      const targetId = selectedInboxCandidateId || (candidatesList[0] ? candidatesList[0].id : null);
      if (targetId) {
        openCandidateWhatsAppMobile(targetId);
      } else {
        alert('Koi candidate ya contact select nahi hai.');
      }
    });
  }

  if (inboxOpenMobileBtn) {
    inboxOpenMobileBtn.addEventListener('click', () => {
      if (selectedInboxCandidateId) {
        openCandidateWhatsAppMobile(selectedInboxCandidateId);
      }
    });
  }

  if (inboxCallBtn) {
    inboxCallBtn.addEventListener('click', () => {
      if (!selectedInboxCandidateId) return;
      const cand = candidatesList.find(c => c.id === selectedInboxCandidateId);
      if (cand && cand.phone) {
        window.open(`https://wa.me/${cand.phone}`, '_blank');
      }
    });
  }

  if (inboxScheduleBtn) {
    inboxScheduleBtn.addEventListener('click', () => {
      if (!selectedInboxCandidateId) return;
      const cand = candidatesList.find(c => c.id === selectedInboxCandidateId);
      if (!cand) return;
      
      scheduleCandidateId.value = cand.id;
      scheduleCandidateInfo.value = `${cand.name} (+${cand.phone})`;
      scheduleRole.value = cand.role || 'Video Editor';

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
  }

  /**
   * Render conversation cards in the left inbox sidebar
   */
  function renderInboxConversationsList() {
    if (!inboxConversationsList) return;

    const total = candidatesList.length;
    const withMsg = candidatesList.filter(c => c.chatHistory && c.chatHistory.length > 0).length;
    const scheduled = candidatesList.filter(c => c.status === 'Interview Scheduled').length;
    const missingResume = candidatesList.filter(c => !c.resumeReceived).length;

    if (inboxFilterAllCount) inboxFilterAllCount.textContent = total;
    if (inboxFilterMsgCount) inboxFilterMsgCount.textContent = withMsg;
    if (inboxFilterSchedCount) inboxFilterSchedCount.textContent = scheduled;
    if (inboxFilterResumeCount) inboxFilterResumeCount.textContent = missingResume;
    const unreadConversations = candidatesList.filter(c => (Number(c.unreadCount) || 0) > 0).length;
    if (navChatCountBadge) navChatCountBadge.textContent = unreadConversations;

    const searchTerm = (inboxSearchInput?.value || '').toLowerCase().trim();

    let filtered = candidatesList.filter(c => {
      // 1. Search Query
      if (searchTerm) {
        const nameMatch = (c.name || '').toLowerCase().includes(searchTerm);
        const phoneMatch = (c.phone || '').includes(searchTerm);
        const roleMatch = (c.role || '').toLowerCase().includes(searchTerm);
        const historyMatch = (c.chatHistory || []).some(m => (m.text || '').toLowerCase().includes(searchTerm));
        if (!nameMatch && !phoneMatch && !roleMatch && !historyMatch) return false;
      }

      // 2. Filter Pills
      if (currentInboxFilter === 'with-history') return c.chatHistory && c.chatHistory.length > 0;
      if (currentInboxFilter === 'interviews') return c.status === 'Interview Scheduled';
      if (currentInboxFilter === 'pending-resume') return !c.resumeReceived;

      return true;
    });

    // Sort conversations: Most recent message first, older messages below
    filtered.sort((a, b) => {
      const getLatestTime = (cand) => {
        if (cand.chatHistory && cand.chatHistory.length > 0) {
          const last = cand.chatHistory[cand.chatHistory.length - 1];
          if (last.timestamp) return new Date(last.timestamp).getTime();
        }
        return new Date(cand.updatedAt || cand.createdAt || 0).getTime();
      };
      return getLatestTime(b) - getLatestTime(a);
    });

    if (filtered.length === 0) {
      inboxConversationsList.innerHTML = `
        <div class="inbox-empty-notice">
          <i class="fa-solid fa-comments fa-2x mb-2 d-block text-dim"></i>
          Koi chat nahi mili.
        </div>
      `;
      return;
    }

    inboxConversationsList.innerHTML = filtered.map(c => {
      const isSelected = c.id === selectedInboxCandidateId;
      const history = c.chatHistory || [];
      const lastMsgObj = history.length > 0 ? history[history.length - 1] : null;
      let lastMsgText = 'No messages yet';
      let lastMsgTime = '';
      let isOutgoing = false;

      if (lastMsgObj) {
        lastMsgText = (lastMsgObj.text || '').replace(/[\r\n]+/g, ' ').substring(0, 45);
        lastMsgTime = formatTime(lastMsgObj.timestamp);
        isOutgoing = lastMsgObj.role === 'assistant';
      } else if (c.createdAt) {
        lastMsgTime = formatTime(c.createdAt);
      }

      const initial = (c.name || 'C').trim().charAt(0).toUpperCase() || 'C';

      // Role Pill Class
      let roleClass = 'badge-role-general';
      if ((c.role || '').toLowerCase().includes('seo')) roleClass = 'badge-role-seo';
      else if ((c.role || '').toLowerCase().includes('video')) roleClass = 'badge-role-video';

      return `
        <div class="wa-chat-item ${isSelected ? 'active' : ''}" data-id="${c.id}">
          <div class="wa-chat-item-avatar">
            <span>${escapeHtml(initial)}</span>
            <span class="wa-online-dot"></span>
          </div>
          <div class="wa-chat-item-content">
            <div class="wa-chat-item-header">
              <span class="wa-chat-item-name">${escapeHtml(c.name || 'Candidate')}</span>
              <span class="wa-chat-item-time">${lastMsgTime}</span>
            </div>
            <div class="wa-chat-item-lastmsg">
              <div class="wa-chat-lastmsg-text">
                ${isOutgoing ? '<span class="text-success"><i class="fa-solid fa-check-double"></i></span> ' : ''}
                <span>${escapeHtml(lastMsgText)}</span>
              </div>
              ${(Number(c.unreadCount) || 0) > 0 ? `<span class="wa-chat-badge-unread">${c.unreadCount}</span>` : ''}
            </div>
            <div class="wa-chat-item-tags">
              <span class="badge-role ${roleClass}" style="font-size:0.65rem; padding:1px 5px;">${escapeHtml(c.role || 'General')}</span>
              ${c.resumeReceived 
                ? '<span class="badge-status badge-status-received" style="font-size:0.62rem; padding:1px 5px;"><i class="fa-solid fa-file-pdf"></i> Resume</span>' 
                : '<span class="badge-status badge-status-pending" style="font-size:0.62rem; padding:1px 5px;">No Resume</span>'}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach click listeners to each conversation item
    document.querySelectorAll('.wa-chat-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        selectInboxContact(id);
      });
    });
  }

  /**
   * Select and load a candidate conversation in the right panel
   */
  async function selectInboxContact(candidateId) {
    selectedInboxCandidateId = candidateId;

    const cand = candidatesList.find(c => c.id === candidateId);
    if (!cand) return;

    // Opening a conversation marks its incoming messages as read immediately.
    if ((Number(cand.unreadCount) || 0) > 0) {
      cand.unreadCount = 0;
      const activeItem = document.querySelector(`.wa-chat-item[data-id="${candidateId}"]`);
      if (activeItem) {
        const badge = activeItem.querySelector('.wa-chat-badge-unread');
        if (badge) badge.remove();
      }
      const unreadConversations = candidatesList.filter(c => (Number(c.unreadCount) || 0) > 0).length;
      if (navChatCountBadge) navChatCountBadge.textContent = unreadConversations;
      fetch(`/api/hiring/candidate/${encodeURIComponent(candidateId)}/read`, { method: 'POST' }).catch(() => {});
    }

    // Highlight left item
    document.querySelectorAll('.wa-chat-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === candidateId);
    });

    // Show Chat Panel, Hide Empty State
    if (inboxEmptyState) inboxEmptyState.style.display = 'none';
    if (inboxActiveChat) inboxActiveChat.style.display = 'flex';

    // Mobile slide transition
    const layout = document.querySelector('.wa-inbox-layout');
    if (layout) layout.classList.add('show-chat');

    // Populate Header Info
    const initial = (cand.name || 'C').trim().charAt(0).toUpperCase() || 'C';
    if (inboxActiveAvatar) inboxActiveAvatar.textContent = initial;
    if (inboxActiveName) inboxActiveName.textContent = cand.name || 'Candidate';
    if (inboxActivePhone) inboxActivePhone.textContent = `+${cand.phone}`;
    if (inboxActiveRoleTag) {
      inboxActiveRoleTag.textContent = cand.role || 'Applicant';
      inboxActiveRoleTag.className = `badge-role ${
        (cand.role || '').toLowerCase().includes('seo') ? 'badge-role-seo' :
        (cand.role || '').toLowerCase().includes('video') ? 'badge-role-video' : 'badge-role-general'
      }`;
    }

    // Populate Info Strip
    if (inboxInfoResume) {
      inboxInfoResume.innerHTML = cand.resumeReceived 
        ? `<i class="fa-solid fa-file-circle-check text-success"></i> Resume: Received` 
        : `<i class="fa-solid fa-file-circle-question text-warning"></i> Resume: Pending`;
    }
    if (inboxInfoInterview) {
      if (cand.interviewDateTime) {
        try {
          const d = new Date(cand.interviewDateTime);
          inboxInfoInterview.innerHTML = `<i class="fa-solid fa-calendar-check text-success"></i> Interview: ${d.toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
        } catch (e) {
          inboxInfoInterview.innerHTML = `<i class="fa-solid fa-calendar-check"></i> Interview: Scheduled`;
        }
      } else {
        inboxInfoInterview.innerHTML = `<i class="fa-solid fa-calendar-xmark text-muted"></i> Interview: Not Set`;
      }
    }
    if (inboxInfoStatus) {
      inboxInfoStatus.innerHTML = `<i class="fa-solid fa-tag text-info"></i> Status: ${escapeHtml(cand.status || 'Applied')}`;
    }

    // Render Chat Messages
    renderInboxChatStream(cand);

    // Auto focus input
    setTimeout(() => {
      if (inboxChatCanvas) inboxChatCanvas.scrollTop = inboxChatCanvas.scrollHeight;
      if (inboxMessageInput) inboxMessageInput.focus();
    }, 40);
  }

  /**
   * Render chat stream for active inbox conversation
   */
  function renderInboxChatStream(candidate) {
    if (!inboxChatStream) return;

    const history = candidate.chatHistory || [];

    if (history.length === 0) {
      inboxChatStream.innerHTML = `
        <div class="wa-msg-row incoming">
          <div class="wa-bubble incoming">
            <div class="wa-bubble-sender">${escapeHtml(candidate.name || 'Candidate')}</div>
            <div class="wa-bubble-text">Hii, I am applying for ${escapeHtml(candidate.role || 'job position')}.</div>
            <div class="wa-bubble-meta">
              <span class="wa-bubble-time">${formatTime(candidate.createdAt || new Date().toISOString())}</span>
            </div>
          </div>
        </div>
      `;
      return;
    }

    let html = '';
    history.forEach((msg) => {
      const isUser = msg.role === 'user';
      const rowClass = isUser ? 'incoming' : 'outgoing';
      const bubbleClass = isUser ? 'incoming' : 'outgoing';
      const senderLabel = isUser ? escapeHtml(candidate.name || 'Candidate') : 'BrandSetu HR';
      const timeStr = formatTime(msg.timestamp);

      // Check for Document / Resume Attachment
      let docCardHtml = '';
      const text = String(msg.text || '').trim();
      if (text.includes('[Document received]') || text.toLowerCase().includes('.pdf') || (candidate.resumeUrl && isUser && text.toLowerCase().includes('resume'))) {
        const docName = candidate.resumeFileName || 'Resume_Document.pdf';
        const docUrl = candidate.resumeUrl || candidate.portfolio || '#';
        docCardHtml = `
          <a href="${docUrl}" target="_blank" class="wa-doc-attachment">
            <div class="wa-doc-icon"><i class="fa-solid fa-file-pdf"></i></div>
            <div class="wa-doc-info">
              <div class="wa-doc-title">${escapeHtml(docName)}</div>
              <div class="wa-doc-sub">PDF Document • Click to View / Download</div>
            </div>
            <div class="wa-doc-download"><i class="fa-solid fa-download"></i></div>
          </a>
        `;
      }

      html += `
        <div class="wa-msg-row ${rowClass}">
          <div class="wa-bubble ${bubbleClass}">
            <div class="wa-bubble-sender">${senderLabel}</div>
            ${docCardHtml}
            <div class="wa-bubble-text">${formatWhatsAppText(msg.text)}</div>
            <div class="wa-bubble-meta">
              <span class="wa-bubble-time">${timeStr}</span>
              ${!isUser ? '<span class="wa-double-ticks" title="Delivered & Read">✓✓</span>' : ''}
            </div>
          </div>
        </div>
      `;
    });

    inboxChatStream.innerHTML = html;
  }

  /**
   * Send WhatsApp Message from Inbox Tab
   */
  async function sendInboxWhatsAppMessage() {
    if (!selectedInboxCandidateId) return;
    const textVal = (inboxMessageInput?.value || '').trim();
    if (!textVal) return;

    const cand = candidatesList.find(c => c.id === selectedInboxCandidateId);
    if (!cand) return;

    // Optimistically update
    if (!cand.chatHistory) cand.chatHistory = [];
    const newMsg = {
      role: 'assistant',
      text: textVal,
      timestamp: new Date().toISOString()
    };
    cand.chatHistory.push(newMsg);
    renderInboxChatStream(cand);
    renderInboxConversationsList();

    if (inboxChatCanvas) inboxChatCanvas.scrollTop = inboxChatCanvas.scrollHeight;
    if (inboxMessageInput) inboxMessageInput.value = '';

    try {
      const res = await fetch('/api/hiring/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateId: cand.id,
          message: textVal
        })
      });
      const data = await res.json();
      if (!data.success) {
        alert('Could not send message via WhatsApp: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Error sending message:', err);
    }
  }

  if (inboxSendBtn) {
    inboxSendBtn.addEventListener('click', sendInboxWhatsAppMessage);
  }

  if (inboxMessageInput) {
    inboxMessageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendInboxWhatsAppMessage();
      }
    });
  }

  // Quick Chips in Inbox Tab
  document.querySelectorAll('.inbox-quick-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      if (!selectedInboxCandidateId) return;
      const cand = candidatesList.find(c => c.id === selectedInboxCandidateId);
      if (!cand) return;

      const template = chip.dataset.template;
      let textToSend = '';

      if (template === 'address') {
        textToSend = `📍 *BrandSetu Digital Office Address:*\n103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Transport Nagar, Indore (M.P.) - 452014\n\nGoogle Maps: https://maps.google.com/?q=Orange+Business+Park+Indore`;
      } else if (template === 'resume') {
        textToSend = `Hello ${cand.name || 'Candidate'}! 😊 Please share your updated *Resume (PDF)* or Portfolio/Drive link here so we can proceed with your application! 📄💼`;
      } else if (template === 'confirm') {
        textToSend = `Dear ${cand.name || 'Candidate'}! 🎉 Your in-person interview for the *${cand.role || 'Applied'}* position is confirmed at our Indore office (103 Orange Business Park, Bhawarkua). Best of luck! 👍`;
      } else if (template === 'reminder') {
        if (!confirm('Send 1-Hr Interview Reminder to this candidate?')) return;
        try {
          const res = await fetch('/api/hiring/send-reminder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidateId: cand.id, type: 'interview' })
          });
          const d = await res.json();
          if (d.success) {
            alert('1-Hr Interview Reminder sent!');
            loadCandidates();
          } else {
            alert('Error: ' + d.error);
          }
        } catch (e) {
          alert('Network error: ' + e.message);
        }
        return;
      }

      if (textToSend && inboxMessageInput) {
        inboxMessageInput.value = textToSend;
        inboxMessageInput.focus();
      }
    });
  });

  // Initial Load Calls
  loadAutoReplyRules();
  loadAiConfig();
  loadCandidates();
});


