const axios = require('axios');

// Test webhook with a sample incoming message
const testPayload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '123456',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '1234567890',
              phone_number_id: '1462718656915585'
            },
            contacts: [
              {
                profile: {
                  name: 'Arjun'
                },
                wa_id: '918357977322'
              }
            ],
            messages: [
              {
                from: '918357977322',
                id: `wamid.test_message_${Date.now()}`, // Unique ID each time
                timestamp: Math.floor(Date.now() / 1000),
                type: 'text',
                text: {
                  body: 'Office kaha pe h'
                }
              }
            ]
          },
          field: 'messages'
        }
      ]
    }
  ]
};

async function testWebhook() {
  try {
    console.log('📤 Sending test webhook to http://localhost:3000/api/whatsapp/webhook');
    console.log('📋 Message ID:', testPayload.entry[0].changes[0].value.messages[0].id);

    const response = await axios.post('http://localhost:3000/api/whatsapp/webhook', testPayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Webhook response:', response.status, response.data);
  } catch (error) {
    console.error('❌ Error:', error.response?.status, error.response?.data || error.message);
  }

  // Keep connection open to see terminal logs
  console.log('\n📡 Check the server terminal for webhook processing logs...');
  setTimeout(() => process.exit(0), 2000);
}

testWebhook();
