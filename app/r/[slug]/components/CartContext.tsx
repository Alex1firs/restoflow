"use client";

import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { loadCart, saveCart, type CartItem } from "./cart-storage";
import { track } from "@/lib/analytics/client";

export type { CartItem };

type CartContextType = {
  items: CartItem[];
  addToCart: (item: Omit<CartItem, 'quantity'>) => void;
  removeFromCart: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  totalPrice: number;
  totalItems: number;
};

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ slug, children }: { slug: string; children: ReactNode }) {
  // Start empty so server render and client hydration match; the persisted cart
  // is loaded in an effect after mount. Keyed per slug so carts never mix.
  const [items, setItems] = useState<CartItem[]>([]);
  const slugRef = useRef(slug);
  // The first `items` change is the hydration load, not a user edit — don't
  // persist it (persisting [] before the load lands would wipe a saved cart).
  const skipNextPersist = useRef(true);

  // Hydrate from localStorage after mount, and re-hydrate if the slug changes
  // (defensive — the slug is stable within a storefront, but this guarantees
  // one restaurant's cart can never bleed into another's).
  useEffect(() => {
    slugRef.current = slug;
    skipNextPersist.current = true;
    // One-time hydration from localStorage after mount. Done in an effect (not a
    // lazy initializer) so the server render and first client render both start
    // empty — otherwise the cart-dependent UI would hydrate-mismatch. Fires once
    // per slug, not a cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(loadCart(slug));
  }, [slug]);

  // Persist on every subsequent change (add/remove/update/clear). Clearing the
  // cart writes an empty cart, which removes the stored key entirely.
  useEffect(() => {
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    saveCart(slugRef.current, items);
  }, [items]);

  const addToCart = (newItem: Omit<CartItem, 'quantity'>) => {
    // Analytics: top-of-funnel add (itemId only, no PII). No-op unless enabled.
    track("add_to_cart", { itemId: newItem.id });
    setItems((prev) => {
      const existing = prev.find((i) => i.id === newItem.id);
      if (existing) {
        return prev.map((i) =>
          i.id === newItem.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { ...newItem, quantity: 1 }];
    });
  };

  const updateQuantity = (id: string, quantity: number) => {
    if (quantity < 1) {
      removeFromCart(id);
      return;
    }
    // Emit add/remove based on the stepper direction (itemId only, no PII).
    const prevQty = items.find((i) => i.id === id)?.quantity ?? 0;
    if (quantity > prevQty) track("add_to_cart", { itemId: id });
    else if (quantity < prevQty) track("remove_from_cart", { itemId: id });
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, quantity } : i))
    );
  };

  const removeFromCart = (id: string) => {
    track("remove_from_cart", { itemId: id });
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const clearCart = () => {
    setItems([]);
  };

  const totalPrice = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <CartContext.Provider
      value={{ items, addToCart, removeFromCart, updateQuantity, clearCart, totalPrice, totalItems }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
