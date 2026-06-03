import "server-only";
import { Resend } from "resend";

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

function from(): string {
  return process.env.EMAIL_FROM ?? "noreply@restoflow.org";
}

export async function sendOnboardingEmail(
  to: string,
  restaurantName: string,
  resetLink: string
): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  await resend.emails.send({
    from: from(),
    to,
    subject: `Welcome to RestoFlow — activate your ${restaurantName} account`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h2 style="margin-bottom:8px">Welcome to RestoFlow</h2>
        <p>Your restaurant <strong>${restaurantName}</strong> is ready. Click the button below to set your password and log in to your dashboard.</p>
        <p style="margin:32px 0">
          <a href="${resetLink}"
             style="background:#16a34a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">
            Set my password
          </a>
        </p>
        <p style="color:#555;font-size:13px">This link expires after first use. If you didn't sign up for RestoFlow, you can ignore this email.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0">
        <p style="color:#888;font-size:12px">RestoFlow · <a href="https://restoflow.org" style="color:#888">restoflow.org</a></p>
      </div>
    `,
  });
}

export async function sendStaffSetupEmail(
  to: string,
  displayName: string,
  restaurantName: string,
  resetLink: string
): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  const name = displayName || "there";

  await resend.emails.send({
    from: from(),
    to,
    subject: `Your RestoFlow staff account is ready`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h2 style="margin-bottom:8px">Your staff account is ready</h2>
        <p>Hi ${name},</p>
        <p>An account has been created for you at <strong>${restaurantName}</strong> on RestoFlow. Click below to set your password.</p>
        <p style="margin:32px 0">
          <a href="${resetLink}"
             style="background:#16a34a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">
            Set my password
          </a>
        </p>
        <p style="color:#555;font-size:13px">This link expires after first use. If you weren't expecting this, contact your restaurant manager.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0">
        <p style="color:#888;font-size:12px">RestoFlow · <a href="https://restoflow.org" style="color:#888">restoflow.org</a></p>
      </div>
    `,
  });
}

export async function sendVerificationEmail(
  to: string,
  verificationLink: string
): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  await resend.emails.send({
    from: from(),
    to,
    subject: "Verify your email address for RestoFlow",
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h2 style="margin-bottom:8px">Verify your email</h2>
        <p>Please click the button below to verify your email address and activate your RestoFlow account.</p>
        <p style="margin:32px 0">
          <a href="${verificationLink}"
             style="background:#f97316;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">
            Verify Email
          </a>
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0">
        <p style="color:#888;font-size:12px">RestoFlow · <a href="https://restoflow.org" style="color:#888">restoflow.org</a></p>
      </div>
    `,
  });
}
