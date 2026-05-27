import dotenv from "dotenv";
import path from "path";

// Load local environment variables
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function registerPhone() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    console.error("❌ Error: WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is not configured in .env.local");
    return;
  }

  console.log(`📡 Attempting to register phone number ID: ${phoneNumberId}...`);
  
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/register`;
  const body = {
    messaging_product: "whatsapp",
    pin: "123456" // Replace with your desired 6-digit PIN if needed
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (res.ok) {
      console.log("✅ Success! The phone number is now officially registered on Meta WhatsApp Business Platform.");
      console.log(data);
    } else {
      console.error("❌ Registration failed!");
      console.error(`Status: ${res.status}`);
      console.error(JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error("❌ Network error:", error);
  }
}

registerPhone();
