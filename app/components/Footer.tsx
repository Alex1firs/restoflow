import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-[#050505] pt-16 pb-8 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-16">
          <div className="col-span-2 md:col-span-1">
            <div className="font-black italic uppercase tracking-tighter text-xl mb-4 text-[#EDEDED]">
              Resto<span className="text-orange-500">Flow</span>
            </div>
            <p className="text-white/40 text-sm leading-relaxed mb-6">
              The digital operating system for modern Nigerian restaurants.
            </p>
          </div>
          
          <div>
            <h4 className="font-bold text-white mb-4 uppercase tracking-wider text-sm">Product</h4>
            <ul className="space-y-3 text-sm text-white/50">
              <li><Link href="/#demo-section" className="hover:text-orange-500 transition-colors">Features</Link></li>
              <li><Link href="/pricing" className="hover:text-orange-500 transition-colors">Pricing</Link></li>
              <li><Link href="/get-started" className="hover:text-orange-500 transition-colors">Sign Up</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-white mb-4 uppercase tracking-wider text-sm">Company</h4>
            <ul className="space-y-3 text-sm text-white/50">
              <li><Link href="#" className="hover:text-orange-500 transition-colors">About Us</Link></li>
              <li><Link href="#" className="hover:text-orange-500 transition-colors">Contact</Link></li>
              <li><Link href="/privacy-policy" className="hover:text-orange-500 transition-colors">Privacy Policy</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-white mb-4 uppercase tracking-wider text-sm">Support</h4>
            <ul className="space-y-3 text-sm text-white/50">
              <li><a href="#" className="hover:text-orange-500 transition-colors flex items-center gap-2">WhatsApp <ArrowRight size={12}/></a></li>
              <li><a href="mailto:hello@braintuneltd.com.ng" className="hover:text-orange-500 transition-colors">Email Us</a></li>
            </ul>
          </div>
        </div>
        
        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-white/40 font-medium">
          <p>© {new Date().getFullYear()} RestoFlow. All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
            <Link href="/privacy-policy" className="hover:text-white transition-colors">Privacy Policy</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
