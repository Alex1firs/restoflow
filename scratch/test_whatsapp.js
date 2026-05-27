const dotenv = require('dotenv');
const path = require('path');
const fetch = require('node-fetch');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function testWhatsApp() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const templateName = process.env.WHATSAPP_TEMPLATE_NEW_ORDER;
  
  // Hardcoded phone number for testing as per user's request
  // Wait, I should use a number the user can check.
  // The user didn't provide a number, but they said "test it".
  // I'll check the 'grills-capitol' restaurant to see if there's a whatsappPhone.
  
  console.log('Testing WhatsApp with:');
  console.log('Template:', templateName);
  console.log('Phone ID:', phoneNumberId);
  
  const body = {
    messaging_product: "whatsapp",
    to: "2347067609816", // Using Grills Capitol notification phone normalized
    type: "template",
    template: {
      name: templateName,
      language: { code: "en" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Grills Capitol" },
            { type: "text", text: "₦15,000" },
            { type: "text", text: "Online" },
            { type: "text", text: "Paid ✓" },
            { type: "text", text: "Test Customer" },
            { type: "text", text: "http://localhost:3000/admin" }
          ]
        }
      ]
    },
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const data = await res.json();
    console.log('Response Status:', res.status);
    console.log('Response Body:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

testWhatsApp();
