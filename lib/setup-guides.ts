export type GuideContent = {
  title: string;
  what: string;
  why: string;
  prepare: string[];
  mistakes: string[];
  videoUrl?: string;
};

export const STEP_GUIDES: Record<string, GuideContent> = {
  business: {
    title: "Business Information",
    what: "Your restaurant's basic details — name, a short description, phone number, and address.",
    why: "Customers need to know who you are and how to reach you. Stores with complete information get more orders because they look trustworthy and professional.",
    prepare: [
      "Decide on a clear, memorable restaurant name.",
      "Write 1–2 sentences describing the type of food you serve.",
      "Have your business phone number ready — one you actively answer.",
      "Have your full address ready, including street, city, and state.",
    ],
    mistakes: [
      "Using a vague name like \"My Food Store\" instead of something specific.",
      "Skipping the description — customers use it to decide whether to order.",
      "Using a phone number you rarely check or answer.",
    ],
  },

  branding: {
    title: "Branding",
    what: "Your logo and cover photo — the visual identity of your store on the RestoFlow platform.",
    why: "First impressions matter. Stores with a logo and a quality cover photo earn significantly more trust from customers before they even look at the menu.",
    prepare: [
      "A square logo image (PNG or JPG, at least 200×200 px). A simple, clear design works best.",
      "A high-quality cover photo of your food or restaurant space. Landscape orientation, well-lit.",
    ],
    mistakes: [
      "Uploading a blurry or very dark logo — customers see it at small sizes.",
      "Using a portrait (tall) photo as the cover — it crops badly on most screens.",
      "Skipping both — a store with no images looks unfinished and reduces trust.",
    ],
  },

  hours: {
    title: "Opening Hours",
    what: "The days of the week and times when your store accepts orders.",
    why: "Without opening hours, customers don't know when to order, and you may receive orders when you're closed. Getting this right prevents confusion and bad reviews.",
    prepare: [
      "Know which days of the week you operate.",
      "Know your opening time and closing time for each active day.",
      "If hours vary by day (e.g. shorter on Sundays), have all variations ready.",
    ],
    mistakes: [
      "Forgetting to enable at least one day — the checklist will not pass if no days are set.",
      "Setting a closing time earlier than your opening time.",
      "Setting hours that don't reflect your actual operations — this leads to unwanted orders.",
    ],
  },

  menu: {
    title: "Menu Setup",
    what: "Your list of food and drink items, each with a name, price, description, and photo.",
    why: "The menu is the most important part of your store. Customers decide to order based entirely on what they see here. You need at least 3 items to go live.",
    prepare: [
      "List your top 5–10 best-selling items to start with — you can always add more later.",
      "Have a price in Naira for each item.",
      "Take photos of your food in natural light. No professional camera needed.",
      "Write a short, appetising description for each item (optional but recommended).",
    ],
    mistakes: [
      "Uploading blurry or dark food photos — this is the single biggest reason customers leave.",
      "Setting prices too high compared to similar local restaurants.",
      "Using unclear names like \"Special 1\" instead of \"Jollof Rice with Chicken\".",
      "Adding items without prices — those items will not be visible to customers.",
    ],
  },

  payment: {
    title: "Payment Setup",
    what: "Your bank account details so online card payments from customers are settled directly into your account.",
    why: "Accepting online payments increases completed orders and reduces the friction of cash collection. You can still accept cash on delivery without this, but online payment customers convert at a much higher rate.",
    prepare: [
      "Your bank account number.",
      "Your bank name.",
      "Your account name as it appears on your bank statement.",
    ],
    mistakes: [
      "Entering wrong account details — payments will fail to settle correctly.",
      "Using a personal savings account that doesn't match your restaurant name (may cause settlement delays).",
      "Skipping this step entirely if you want to grow online orders.",
    ],
  },

  preview: {
    title: "Preview Your Storefront",
    what: "A live look at exactly what your customers see when they open your store link.",
    why: "Spotting errors before launch is far easier than correcting them after real customers see them. Use this step to catch wrong prices, missing photos, and spelling mistakes.",
    prepare: [
      "No preparation needed — just review carefully.",
      "Check on your phone, since most customers order on mobile.",
      "Look at the menu list, item photos, your store name, and opening hours.",
    ],
    mistakes: [
      "Skipping the preview entirely and going straight to submit.",
      "Only checking on desktop — mobile layout can look very different.",
      "Missing a misspelled item name or a wrong price.",
    ],
  },

  readiness: {
    title: "Publish Readiness",
    what: "A final checklist confirming every important part of your store is complete before you submit for review.",
    why: "Submitting a complete store gets reviewed and approved much faster. Incomplete submissions are returned, which delays your launch.",
    prepare: [
      "Make sure all required steps above this one are marked complete.",
      "Do a final preview of your store if you haven't already (Step 6).",
      "Have your contact details ready in case the review team needs to reach you.",
    ],
    mistakes: [
      "Submitting with only 1–2 menu items — you need at least 3.",
      "Submitting before setting opening hours.",
      "Submitting with placeholder text in your restaurant description.",
    ],
  },
};
