import "server-only";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/business.manage",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

export function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "";
  return {
    clientId,
    clientSecret,
    redirectUri,
    configured: !!(clientId && clientSecret && redirectUri),
  };
}

export function buildAuthUrl(state: string): string {
  const { clientId, redirectUri } = getGoogleConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number;
  email: string;
  googleUserId: string;
}> {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig();

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const accessToken = data.access_token;
  const refreshToken = data.refresh_token ?? "";
  const tokenExpiry = Date.now() + data.expires_in * 1000;

  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const userInfo = (await userRes.json()) as { email: string; id: string };

  return {
    accessToken,
    refreshToken,
    tokenExpiry,
    email: userInfo.email,
    googleUserId: userInfo.id,
  };
}

async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; tokenExpiry: number }> {
  const { clientId, clientSecret } = getGoogleConfig();

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) throw new Error("Token refresh failed — user may need to reconnect");

  const data = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    tokenExpiry: Date.now() + data.expires_in * 1000,
  };
}

export async function getValidAccessToken(slug: string): Promise<string> {
  const { getAdminDb } = await import("./firebase-admin");
  const db = getAdminDb();

  const tokenDoc = await db.collection("google_tokens").doc(slug).get();
  if (!tokenDoc.exists) throw new Error("No Google account connected");

  const { accessToken, refreshToken, tokenExpiry } = tokenDoc.data() as {
    accessToken: string;
    refreshToken: string;
    tokenExpiry: number;
  };

  if (Date.now() > tokenExpiry - 300_000) {
    const { accessToken: newToken, tokenExpiry: newExpiry } =
      await refreshAccessToken(refreshToken);
    await db.collection("google_tokens").doc(slug).update({
      accessToken: newToken,
      tokenExpiry: newExpiry,
    });
    return newToken;
  }

  return accessToken;
}

export async function listGbpAccounts(
  accessToken: string
): Promise<{ name: string; accountName: string; type: string }[]> {
  const res = await fetch(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`GBP accounts fetch failed: ${res.status}`);
  const data = (await res.json()) as {
    accounts?: { name: string; accountName: string; type: string }[];
  };
  return data.accounts ?? [];
}

export interface GbpLocation {
  name: string;
  title: string;
  storefrontAddress?: {
    addressLines?: string[];
    locality?: string;
    regionCode?: string;
  };
  websiteUri?: string;
  regularHours?: unknown;
  phoneNumbers?: { primaryPhone?: string };
  categories?: { primaryCategory?: { name: string; displayName?: string } };
  profile?: { description?: string };
  metadata?: { mapsUri?: string; newReviewUri?: string };
}

export async function listGbpLocations(
  accessToken: string,
  accountName: string
): Promise<GbpLocation[]> {
  const res = await fetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations` +
      `?readMask=name,title,storefrontAddress,websiteUri,regularHours,phoneNumbers,categories,profile,metadata`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`GBP locations fetch failed: ${res.status}`);
  const data = (await res.json()) as { locations?: GbpLocation[] };
  return data.locations ?? [];
}

export async function createGbpLocation(
  accessToken: string,
  accountName: string,
  payload: Record<string, unknown>
): Promise<GbpLocation> {
  const res = await fetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations` +
      `?validateOnly=false&requestId=restaflow-${Date.now()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const err = (await res.json()) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? "Failed to create GBP listing");
  }

  return (await res.json()) as GbpLocation;
}

export async function updateGbpLocation(
  accessToken: string,
  locationName: string,
  payload: Record<string, unknown>
): Promise<GbpLocation> {
  const updateMask = Object.keys(payload).join(",");
  const res = await fetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}?updateMask=${updateMask}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const err = (await res.json()) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? "Failed to update GBP listing");
  }

  return (await res.json()) as GbpLocation;
}
