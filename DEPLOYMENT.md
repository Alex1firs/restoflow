# Deployment Guide: Restaurant Ordering SaaS (restoflow)

This guide provides instructions for deploying the project to **Vercel** with a **Firebase** backend.

## 1. Prerequisites
- A Vercel account.
- A Firebase project with Firestore enabled.
- Firebase Web App configuration credentials.

## 2. Environment Variables
Ensure the following variables are set in your Vercel Project Settings (Environment Variables):

| Key | Description |
|-----|-------------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase API Key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase Auth Domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase Project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase Storage Bucket |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase Messaging Sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase App ID |

## 3. Deployment Steps on Vercel
1. **Push your code** to a GitHub/GitLab/Bitbucket repository.
2. **Import Project** into Vercel.
3. **Configure Build Settings**:
   - **Framework Preset**: Next.js
   - **Build Command**: `npm run build`
   - **Install Command**: `npm install`
4. **Add Environment Variables** (listed above).
5. **Deploy!**

## 4. Firebase Configuration
- **Firestore Rules**: Ensure your Firestore rules allow reads/writes for the required collections (`restaurants`, `menu_items`, `orders`).
- **CORS**: If you encounter CORS issues with images, configure the Google Cloud Storage CORS settings for your bucket.

## 5. Recommended Project Name
- **Production URL Suggestion**: `restoflow.vercel.app`

## 6. Verification Checklist
- [ ] Visit `/r/[slug]` to see the restaurant landing page.
- [ ] Visit `/r/[slug]?view=menu` to verify QR Menu mode (Direct Menu access).
- [ ] Verify that ordering works and saves to Firestore.
- [ ] Access Admin dashboard at `/admin/[slug]/orders` and `/admin/[slug]/menu`.
