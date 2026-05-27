const dotenv = require('dotenv');
const path = require('path');
const fetch = require('node-fetch');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function testWhatsApp() {
  // Testing the OLD token provided in the previous configuration
  const accessToken = "EAAcumamE5EkBRQRyo1SlLGcaOT9JLJQnQ2TGk3TcjZAjTimtVYBGyvhu3t7SS1irUYK4GndWSI2AXHzQJ7vi9ir79h4MgomhyG5uzLowjQoZAFg8GvZBhqx0INbduRItkzpM97JsOgAZBZBtnQuhLwI0KyVZCHV3KqRZCUtEibBVIPm8i5aiJZA6oetvgc5vvQZDZD";
  const phoneNumberId = "1069200429603265";
  const templateName = "new_order_alert";
  
  console.log('Testing WhatsApp with OLD TOKEN:');
  
  const body = {
    messaging_product: "whatsapp",
    to: "2347067609816",
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
