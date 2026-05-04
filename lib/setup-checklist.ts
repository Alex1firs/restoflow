export type ChecklistItem = {
  key: string;
  label: string;
  hint: string;
  points: number;
  required: boolean;
  passed: boolean;
};

export type SetupChecklist = {
  items: ChecklistItem[];
  score: number;       // 0–100
  canSubmit: boolean;  // all required items passed
};

function hasOpenDay(openingHours: unknown): boolean {
  if (!openingHours || typeof openingHours !== "object") return false;
  return Object.values(openingHours as Record<string, unknown>).some(
    (d) => typeof d === "object" && d !== null && (d as Record<string, unknown>).open === true
  );
}

export function computeSetupChecklist(
  data: Record<string, unknown>,
  menuItemCount: number
): SetupChecklist {
  const str = (v: unknown) => typeof v === "string" ? v.trim() : "";

  const defs: Omit<ChecklistItem, "passed">[] = [
    {
      key: "name",
      label: "Restaurant name",
      hint: "Set your restaurant name in Settings.",
      points: 15,
      required: true,
    },
    {
      key: "description",
      label: "Restaurant description",
      hint: "Add a description (at least 10 characters) in Settings.",
      points: 10,
      required: true,
    },
    {
      key: "phone",
      label: "Contact phone number",
      hint: "Add a phone number in Settings.",
      points: 10,
      required: true,
    },
    {
      key: "address",
      label: "Restaurant address",
      hint: "Add your address in Settings.",
      points: 10,
      required: true,
    },
    {
      key: "openingHours",
      label: "Opening hours",
      hint: "Configure at least one open day in Settings → Opening Hours.",
      points: 15,
      required: true,
    },
    {
      key: "menuItems",
      label: "Menu items (min. 3)",
      hint: "Add at least 3 menu items in the Menu section.",
      points: 20,
      required: true,
    },
    {
      key: "logo",
      label: "Restaurant logo",
      hint: "Upload a logo in Settings for a professional look.",
      points: 5,
      required: false,
    },
    {
      key: "coverImage",
      label: "Cover image",
      hint: "Upload a cover photo in Settings.",
      points: 5,
      required: false,
    },
    {
      key: "payment",
      label: "Online payment setup",
      hint: "Configure your bank account in Payment Settings to accept online orders.",
      points: 10,
      required: false,
    },
  ];

  const items: ChecklistItem[] = defs.map((d) => {
    let passed = false;
    switch (d.key) {
      case "name":         passed = str(data.name).length > 0; break;
      case "description":  passed = str(data.description).length >= 10; break;
      case "phone":        passed = str(data.phone).length > 0; break;
      case "address":      passed = str(data.address).length > 0; break;
      case "openingHours": passed = hasOpenDay(data.openingHours); break;
      case "menuItems":    passed = menuItemCount >= 3; break;
      case "logo":         passed = str(data.logo).length > 0; break;
      case "coverImage":   passed = str(data.coverImage).length > 0; break;
      case "payment":      passed = str(data.paystackSubaccountCode).length > 0; break;
    }
    return { ...d, passed };
  });

  const score = items.reduce((s, i) => s + (i.passed ? i.points : 0), 0);
  const canSubmit = items.filter((i) => i.required).every((i) => i.passed);

  return { items, score, canSubmit };
}
