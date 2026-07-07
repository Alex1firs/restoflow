"use client";

import Link from "next/link";
import { useState } from "react";
import ContactModal from "./ContactModal";

export default function PublicNav() {
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="text-white font-black text-lg tracking-tight italic">
            RestoFlow
          </Link>
          <div className="flex items-center gap-4 sm:gap-6">
            <Link href="/discover" className="text-gray-400 text-sm font-medium hover:text-white transition">
              Find Food
            </Link>
            <button
              onClick={() => setIsContactModalOpen(true)}
              className="hidden sm:inline text-gray-400 text-sm font-medium hover:text-white transition"
            >
              Contact
            </button>
            <Link href="/pricing" className="text-gray-400 text-sm font-medium hover:text-white transition">
              Pricing
            </Link>
            <Link href="/admin/login" className="text-gray-400 text-sm font-medium hover:text-white transition">
              Login
            </Link>
            <Link
              href="/get-started"
              className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-4 py-2 rounded-lg transition"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      <ContactModal 
        isOpen={isContactModalOpen} 
        onClose={() => setIsContactModalOpen(false)} 
      />
    </>
  );
}
