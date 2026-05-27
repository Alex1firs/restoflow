"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc
} from "firebase/firestore";
import ImageUpload from "@/app/components/ImageUpload";
import AiTextHelper from "@/app/components/AiTextHelper";

type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  category: string;
  available: boolean;
};

type Props = {
  aiEnabled?: boolean;
  restaurant: {
    id: string;
    name: string;
    slug: string;
  };
};

function newImageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function AdminMenuClient({ restaurant, aiEnabled = false }: Props) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [imageId, setImageId] = useState(newImageId);

  const [formData, setFormData] = useState({
    name: "",
    price: "",
    category: "",
    description: "",
    image: "",
    available: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [categorySuggestions, setCategorySuggestions] = useState<string[] | null>(null);
  const [fetchingCategories, setFetchingCategories] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, "menu_items"),
      where("restaurantId", "==", restaurant.slug)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const itemsData = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data()
      })) as MenuItem[];
      setItems(itemsData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [restaurant.slug]);

  const resetForm = () => {
    setFormData({ name: "", price: "", category: "", description: "", image: "", available: true });
    setEditingItem(null);
    setShowForm(false);
    setError(null);
    setImageId(newImageId());
    setCategorySuggestions(null);
  };

  async function suggestCategories() {
    if (fetchingCategories) return;
    setFetchingCategories(true);
    setCategorySuggestions(null);
    try {
      const res = await fetch("/api/admin/ai/category-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemNames: items.slice(0, 20).map((i) => i.name) }),
      });
      if (res.status === 503 || !res.ok) return;
      const data = await res.json() as { suggestions?: string[] };
      setCategorySuggestions(data.suggestions ?? []);
    } catch {
      // silently fail — setup still works without AI
    } finally {
      setFetchingCategories(false);
    }
  }

  const handleEdit = (item: MenuItem) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      price: item.price.toString(),
      category: item.category,
      description: item.description,
      image: item.image,
      available: item.available,
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.name.trim() || !formData.price || !formData.category.trim()) {
      setError("Please fill in all required fields.");
      return;
    }

    const priceNum = parseFloat(formData.price);
    if (isNaN(priceNum) || priceNum <= 0) {
      setError("Price must be a valid number greater than 0.");
      return;
    }

    try {
      const itemData = {
        restaurantId: restaurant.slug,
        name: formData.name.trim(),
        price: priceNum,
        category: formData.category.trim(),
        description: formData.description.trim(),
        image: formData.image || "",
        available: formData.available,
      };

      if (editingItem) {
        await updateDoc(doc(db, "menu_items", editingItem.id), itemData);
      } else {
        await addDoc(collection(db, "menu_items"), itemData);
      }
      resetForm();
    } catch (err) {
      console.error("Save failed:", err);
      setError("Failed to save item. Please try again.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this item?")) return;
    try {
      await deleteDoc(doc(db, "menu_items", id));
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Failed to delete item.");
    }
  };

  const toggleAvailability = async (item: MenuItem) => {
    try {
      await updateDoc(doc(db, "menu_items", item.id), { available: !item.available });
    } catch (err) {
      console.error("Toggle failed:", err);
    }
  };

  const imageStoragePath = editingItem
    ? `restaurants/${restaurant.slug}/menu-items/${editingItem.id}`
    : `restaurants/${restaurant.slug}/menu-items/${imageId}`;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-black text-gray-900">Menu Management</h1>
          <p className="text-gray-500 font-medium">{restaurant.name}</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-6 rounded-2xl transition-all transform active:scale-95 shadow-lg flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4"></path></svg>
            Add New Item
          </button>
        )}
      </div>

      {/* Contextual help */}
      {!showForm && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-start gap-3 mb-8">
          <svg className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs text-blue-700 font-medium leading-relaxed">
            Start with your best-selling meals. Use clear names, accurate prices, and good food images — customers are more likely to order when they can see what they&apos;re getting.
          </p>
        </div>
      )}

      {showForm && (
        <div className="bg-white border rounded-3xl p-8 shadow-sm mb-12 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold">{editingItem ? "Edit Menu Item" : "Add New Menu Item"}</h2>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600 font-medium">Cancel</button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Item Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    placeholder="e.g. Classic Burger"
                    className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Price (₦) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.price}
                    onChange={(e) => setFormData({...formData, price: e.target.value})}
                    placeholder="e.g. 1299"
                    className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Category *</label>
                  <input
                    type="text"
                    value={formData.category}
                    onChange={(e) => { setFormData({...formData, category: e.target.value}); setCategorySuggestions(null); }}
                    placeholder="e.g. Mains, Appetizers, Drinks"
                    className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none"
                  />
                  {aiEnabled && !categorySuggestions && (
                    <button
                      type="button"
                      onClick={suggestCategories}
                      disabled={fetchingCategories}
                      className="inline-flex items-center gap-1.5 text-xs font-black text-orange-600 hover:text-orange-700 transition-colors mt-1.5 disabled:opacity-50"
                    >
                      {fetchingCategories ? (
                        <>
                          <div className="w-3.5 h-3.5 rounded-full border-2 border-orange-400 border-t-transparent animate-spin" />
                          Suggesting…
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          Suggest categories with AI
                        </>
                      )}
                    </button>
                  )}
                  {categorySuggestions && categorySuggestions.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      <p className="text-xs font-bold text-orange-500 uppercase tracking-wide">Suggestions — tap to use</p>
                      <div className="flex flex-wrap gap-1.5">
                        {categorySuggestions.map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => { setFormData((f) => ({ ...f, category: cat })); setCategorySuggestions(null); }}
                            className="text-xs font-black bg-orange-50 border border-orange-200 text-orange-700 hover:bg-orange-100 px-2.5 py-1 rounded-lg transition-colors"
                          >
                            {cat}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setCategorySuggestions(null)}
                          className="text-xs font-black text-gray-400 hover:text-gray-600 px-2 py-1 transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    placeholder="Brief description of the item..."
                    rows={4}
                    className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none resize-none"
                  />
                  {aiEnabled && (
                    <AiTextHelper
                      triggerLabel={formData.description ? "Improve with AI" : "Generate with AI"}
                      endpoint="/api/admin/ai/menu-description"
                      payload={() => ({
                        itemName: formData.name,
                        category: formData.category || undefined,
                      })}
                      onAccept={(text) => setFormData((f) => ({ ...f, description: text }))}
                    />
                  )}
                </div>
              </div>
              <div className="space-y-4">
                <ImageUpload
                  label="Item Image"
                  value={formData.image}
                  onChange={(url) => setFormData({...formData, image: url})}
                  storagePath={imageStoragePath}
                  aspect="square"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="available"
                checked={formData.available}
                onChange={(e) => setFormData({...formData, available: e.target.checked})}
                className="w-5 h-5 accent-orange-600 rounded"
              />
              <label htmlFor="available" className="text-sm font-bold text-gray-700">Currently Available for Order</label>
            </div>

            {error && <p className="text-red-500 text-sm font-medium bg-red-50 p-3 rounded-xl">{error}</p>}

            <button
              type="submit"
              className="w-full md:w-auto bg-gray-900 hover:bg-black text-white font-bold py-4 px-12 rounded-2xl shadow-lg transition-all transform active:scale-95"
            >
              {editingItem ? "Update Item" : "Create Item"}
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center font-bold text-gray-400">Loading menu items...</div>
      ) : items.length === 0 ? (
        <div className="bg-white border text-center py-20 rounded-3xl border-dashed">
          <p className="text-gray-400">Your menu is empty. Start by adding your first item!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((item) => (
            <div key={item.id} className="bg-white border border-gray-100 rounded-3xl overflow-hidden shadow-sm flex flex-col group transition-all hover:shadow-md">
              <div className="h-48 relative overflow-hidden bg-gray-100">
                {item.image ? (
                  <img src={item.image} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300">
                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
                <div className="absolute top-4 left-4">
                  <span className="bg-white/90 backdrop-blur-sm text-xs font-bold uppercase px-2 py-1 rounded-lg text-gray-600 border border-white">
                    {item.category}
                  </span>
                </div>
              </div>

              <div className="p-6 flex flex-col flex-1">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-lg text-gray-900 capitalize">{item.name}</h3>
                  <span className="font-black text-orange-600">₦{item.price.toFixed(2)}</span>
                </div>
                <p className="text-sm text-gray-500 line-clamp-2 mb-6 italic">{item.description}</p>

                <div className="mt-auto space-y-4">
                  <div className="flex justify-between items-center bg-gray-50 p-2 rounded-xl">
                    <span className={`text-xs font-bold uppercase px-2 ${item.available ? 'text-green-600' : 'text-red-400'}`}>
                      {item.available ? "Available" : "Sold Out"}
                    </span>
                    <button
                      onClick={() => toggleAvailability(item)}
                      className={`relative w-10 h-6 flex items-center rounded-full transition-colors ${item.available ? 'bg-orange-600' : 'bg-gray-300'}`}
                    >
                      <div className={`w-4 h-4 bg-white rounded-full mx-1 transition-transform ${item.available ? 'translate-x-4' : 'translate-x-0'}`}></div>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleEdit(item)}
                      className="text-sm font-bold py-2.5 border rounded-xl hover:bg-gray-50 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="text-sm font-bold py-2.5 border border-red-100 text-red-500 hover:bg-red-50 transition-colors rounded-xl"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
