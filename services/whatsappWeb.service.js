const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const EventEmitter = require('events');
const path = require('path');

class WhatsAppWebService extends EventEmitter {
  constructor() {
    super();
    this.qrDataUrl = null;
    this.status = 'disconnected';
    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '..', '.wwebjs_auth') }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--disable-gpu'
        ]
      }
    });
    this.registerEvents();
  }

  registerEvents() {
    this.client.on('qr', async qr => {
      this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      this.status = 'qr';
      this.emit('status', this.getStatus());
      this.emit('qr', this.qrDataUrl);
      console.log('📱 WhatsApp Web QR is ready. Open the dashboard and scan it from WhatsApp > Linked devices.');
    });

    this.client.on('authenticated', () => {
      this.status = 'authenticated';
      this.emit('status', this.getStatus());
    });

    this.client.on('ready', () => {
      this.status = 'connected';
      this.qrDataUrl = null;
      this.emit('status', this.getStatus());
      console.log('✅ WhatsApp Web connected successfully.');
    });

    this.client.on('auth_failure', error => {
      this.status = 'error';
      this.emit('status', { ...this.getStatus(), message: error.message });
      console.error('WhatsApp Web authentication failed:', error.message);
    });

    this.client.on('disconnected', reason => {
      this.status = 'disconnected';
      this.emit('status', { ...this.getStatus(), message: reason });
    });

    this.client.on('message', async message => {
      if (message.fromMe || message.from === 'status@broadcast') return;
      if (message.from.endsWith('@g.us') || message.from.includes('@g.us') || message.from.endsWith('@newsletter') || message.from.includes('@broadcast')) return;

      // Ignore old sync messages older than 2 hours to prevent dummy records
      const msgAgeMs = Date.now() - (message.timestamp * 1000);
      if (msgAgeMs > 2 * 60 * 60 * 1000) return;

      const contact = await message.getContact();
      let messageText = message.body || '';
      if (message.hasMedia && !messageText) {
        messageText = message.type === 'document' ? '[Document received]' : `[${message.type} received]`;
      }
      this.emit('message', {
        customerPhone: contact.number || message.from.replace(/@c\.us$/, ''),
        chatId: message.from,
        customerName: contact.pushname || contact.name || 'Customer',
        messageText,
        messageType: message.type,
        messageId: message.id?._serialized || message.id?.id,
        timestamp: new Date(message.timestamp * 1000).toISOString()
      });
    });
  }

  async initialize() {
    if (this.status === 'connecting' || this.status === 'connected' || this.status === 'authenticated') return;
    this.status = 'connecting';
    this.emit('status', this.getStatus());
    await this.client.initialize();
  }

  async sendWhatsAppText(to, message) {
    if (this.status !== 'connected') throw new Error('WhatsApp Web is not connected. Scan the QR code first.');
    const target = String(to || '').trim();
    if (!target) throw new Error('Recipient address is required.');

    if (target.includes('@')) {
      return this.client.sendMessage(target, message);
    }

    const phone = target.replace(/[^0-9]/g, '');
    
    // If digits >= 14, it is a WhatsApp Multi-device Privacy LID
    if (phone.length >= 14) {
      try {
        return await this.client.sendMessage(`${phone}@lid`, message);
      } catch (lidErr) {
        console.warn(`Send to ${phone}@lid failed, attempting fallback...`, lidErr.message);
      }
    }

    const normalizedPhone = phone.length === 10 ? `91${phone}` : phone;
    try {
      const numberId = await this.client.getNumberId(normalizedPhone);
      if (numberId && numberId._serialized) {
        return await this.client.sendMessage(numberId._serialized, message);
      }
    } catch (e) {}

    try {
      return await this.client.sendMessage(`${normalizedPhone}@c.us`, message);
    } catch (cUsErr) {
      // If @c.us threw "No LID for user", retry with @lid
      return await this.client.sendMessage(`${phone}@lid`, message);
    }
  }

  async sendMedia(to, filePath, caption = '') {
    if (this.status !== 'connected') throw new Error('WhatsApp Web is not connected. Scan the QR code first.');
    if (String(to).includes('@')) return this.client.sendMessage(String(to), MessageMedia.fromFilePath(filePath), { caption });
    const phone = String(to).replace(/[^0-9]/g, '');
    const normalizedPhone = phone.length === 10 ? `91${phone}` : phone;
    const numberId = await this.client.getNumberId(normalizedPhone);
    if (!numberId) throw new Error(`WhatsApp number +${normalizedPhone} is not available on this account.`);
    const media = MessageMedia.fromFilePath(filePath);
    return this.client.sendMessage(numberId._serialized, media, { caption });
  }

  getStatus() {
    return {
      provider: 'web',
      status: this.status,
      configured: true,
      qr: this.qrDataUrl,
      message: this.status === 'qr' ? 'Scan the QR code from WhatsApp Linked Devices.' : ''
    };
  }
}

module.exports = new WhatsAppWebService();
