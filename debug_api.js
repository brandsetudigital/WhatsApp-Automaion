const axios = require('axios');
require('dotenv').config();

/**
 * Debug script to check WhatsApp API response errors
 */

async function testDirectMessage() {
  try {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    
    console.log('🔍 Testing Direct Message to WhatsApp API...\n');
    console.log(`📌 Phone Number ID: ${phoneNumberId}`);
    console.log(`📌 Sending to: 918357977322\n`);

    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '918357977322',
      type: 'text',
      text: {
        preview_url: false,
        body: 'Testing auto-reply from Brand Setu ✨'
      }
    };

    console.log('📤 Sending payload:', JSON.stringify(payload, null, 2));
    console.log('\n⏳ Waiting for API response...\n');

    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ SUCCESS! Message sent to Meta API');
    console.log('📩 Response:', JSON.stringify(response.data, null, 2));
    console.log('\n✨ If you got a message ID above, then the message was sent to Meta.');
    console.log('📌 Common reasons for not receiving:');
    console.log('   1. Number is not registered in your Meta Business Account');
    console.log('   2. Number needs to be added as a TEST number in Meta for Developers');
    console.log('   3. This is a new WhatsApp Business account (needs warm-up period)');

  } catch (error) {
    console.error('❌ ERROR from Meta API:\n');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Error:', JSON.stringify(error.response.data, null, 2));
      
      const err = error.response.data?.error;
      if (err?.code === 131056) {
        console.log('\n🚨 ERROR CODE 131056: Unsupported phone number');
        console.log('✅ FIX: Add this number as a TEST number in your Meta for Developers account');
        console.log('👉 Go to: Meta for Developers > Apps > Your App > WhatsApp > Test Numbers');
      }
    } else {
      console.error('Error:', error.message);
    }
  }
}

testDirectMessage();
