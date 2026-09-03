const fs = require('fs');
const hiringService = require('../services/hiring.service');

function getCandidates(req, res) {
  try {
    const candidates = hiringService.getCandidates();
    const stats = hiringService.getHiringStats();
    res.json({ success: true, count: candidates.length, candidates, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

function markCandidateMessagesRead(req, res) {
  try {
    const candidate = hiringService.markCandidateMessagesRead(req.params.id);
    res.json({ success: true, candidate });
  } catch (err) {
    const status = err.message === 'Candidate not found' ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
}

async function scheduleCandidateInterview(req, res) {
  try {
    const { candidateId, interviewDateTime, role, notes, sendInstantConfirmation } = req.body;
    if (!candidateId || !interviewDateTime) {
      return res.status(400).json({ success: false, error: 'Candidate ID and interview date/time are required' });
    }

    const candidate = await hiringService.scheduleInterview(
      candidateId,
      interviewDateTime,
      role,
      notes,
      sendInstantConfirmation !== false
    );

    res.json({ success: true, message: 'Interview scheduled and confirmation sent!', candidate });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function sendCandidateReminder(req, res) {
  try {
    const { candidateId, type } = req.body;
    if (!candidateId) {
      return res.status(400).json({ success: false, error: 'Candidate ID is required' });
    }

    if (type === 'interview') {
      const candidates = hiringService.getCandidates();
      const cand = candidates.find(c => c.id === candidateId || c.phone === candidateId);
      if (!cand) return res.status(404).json({ success: false, error: 'Candidate not found' });
      await hiringService.sendInterview1HrReminder(cand);
      res.json({ success: true, message: 'Interview reminder sent successfully!' });
    } else {
      const updated = await hiringService.sendResumeReminder(candidateId);
      res.json({ success: true, message: 'Resume reminder sent successfully!', candidate: updated });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

function updateCandidate(req, res) {
  try {
    const { id } = req.params;
    const candidates = hiringService.getCandidates();
    const candidate = candidates.find(c => c.id === id || c.phone === id);
    if (!candidate) {
      return res.status(404).json({ success: false, error: 'Candidate not found' });
    }

    const { name, role, city, experience, portfolio, resumeReceived, status, notes, interviewDateTime } = req.body;
    if (name !== undefined) candidate.name = name;
    if (role !== undefined) candidate.role = role;
    if (city !== undefined) candidate.city = city;
    if (experience !== undefined) candidate.experience = experience;
    if (portfolio !== undefined) candidate.portfolio = portfolio;
    if (resumeReceived !== undefined) candidate.resumeReceived = !!resumeReceived;
    if (status !== undefined) candidate.status = status;
    if (notes !== undefined) candidate.notes = notes;
    if (interviewDateTime !== undefined) candidate.interviewDateTime = interviewDateTime;
    candidate.updatedAt = new Date().toISOString();

    hiringService.saveCandidatesAndSyncExcel();
    res.json({ success: true, message: 'Candidate updated successfully', candidate });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

function createCandidate(req, res) {
  try {
    const { name, phone, role, city, experience, portfolio, resumeReceived, notes } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Phone number is required' });
    }

    const candidate = hiringService.trackCandidateFromMessage({
      customerPhone: phone,
      customerName: name || 'Candidate',
      messageText: `Manual Entry: Role ${role || 'SEO / Video Editor'}, Portfolio: ${portfolio || 'N/A'}`
    });

    if (candidate) {
      if (role) candidate.role = role;
      if (city) candidate.city = city;
      if (experience) candidate.experience = experience;
      if (portfolio) candidate.portfolio = portfolio;
      if (resumeReceived !== undefined) candidate.resumeReceived = !!resumeReceived;
      if (notes) candidate.notes = notes;
      hiringService.saveCandidatesAndSyncExcel();
    }

    res.json({ success: true, message: 'Candidate added successfully', candidate });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

function deleteCandidate(req, res) {
  try {
    const { id } = req.params;
    let candidates = hiringService.getCandidates();
    const index = candidates.findIndex(c => c.id === id || c.phone === id);
    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Candidate not found' });
    }
    candidates.splice(index, 1);
    hiringService.saveCandidatesAndSyncExcel();
    res.json({ success: true, message: 'Candidate removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

function exportExcel(req, res) {
  try {
    hiringService.saveCandidatesAndSyncExcel();
    if (!fs.existsSync(hiringService.CANDIDATES_EXCEL_FILE)) {
      return res.status(404).json({ success: false, error: 'Excel file not generated yet' });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=BrandSetu_Hiring_Candidates.xlsx');
    res.download(hiringService.CANDIDATES_EXCEL_FILE, 'BrandSetu_Hiring_Candidates.xlsx');
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function sendCandidateMessage(req, res) {
  try {
    const { candidateId, message } = req.body;
    if (!candidateId || !message) {
      return res.status(400).json({ success: false, error: 'Candidate ID and message are required' });
    }

    const result = await hiringService.sendMessageToCandidate(candidateId, message);
    res.json({ success: true, message: 'Message sent successfully via WhatsApp!', candidate: result.candidate });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  getCandidates,
  markCandidateMessagesRead,
  scheduleCandidateInterview,
  sendCandidateReminder,
  sendCandidateMessage,
  updateCandidate,
  createCandidate,
  deleteCandidate,
  exportExcel
};

