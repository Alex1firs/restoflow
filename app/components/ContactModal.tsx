"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Phone, Copy, CheckCircle2 } from "lucide-react";
import { useState } from "react";

interface ContactModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ContactModal({ isOpen, onClose }: ContactModalProps) {
  const [copied, setCopied] = useState(false);
  const phoneNumber = "07067609816";

  const handleCopy = () => {
    navigator.clipboard.writeText(phoneNumber);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-md overflow-hidden rounded-3xl bg-[#0a0a0a] border border-white/10 p-8 shadow-2xl"
          >
            <button
              onClick={onClose}
              className="absolute right-4 top-4 rounded-full p-2 text-white/50 hover:bg-white/10 hover:text-white transition"
            >
              <X size={20} />
            </button>
            
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-orange-500/10 text-orange-500 border border-orange-500/20">
              <Phone size={28} />
            </div>

            <h3 className="mb-2 text-2xl font-black italic uppercase tracking-tight text-white">
              Let's Talk
            </h3>
            <p className="mb-8 text-white/60">
              Have questions or want to sign up? Reach out to us for support or inquiries. We are always here to help!
            </p>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between rounded-xl bg-white/5 p-4 border border-white/5">
                <div className="flex items-center gap-3">
                  <Phone size={18} className="text-white/40" />
                  <span className="text-xl font-bold tracking-wider text-white">
                    {phoneNumber}
                  </span>
                </div>
                <button
                  onClick={handleCopy}
                  className="flex items-center justify-center h-10 w-10 rounded-lg bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition"
                  title="Copy to clipboard"
                >
                  {copied ? <CheckCircle2 size={18} className="text-green-500" /> : <Copy size={18} />}
                </button>
              </div>

              <a
                href={`tel:${phoneNumber}`}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-4 font-bold text-white hover:bg-orange-600 transition shadow-lg shadow-orange-500/20"
              >
                <Phone size={18} />
                Tap to Call Now
              </a>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
