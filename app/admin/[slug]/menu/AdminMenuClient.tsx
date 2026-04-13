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
  restaurant: {
    id: string;
    name: string;
    slug: string;
  };
};

export default function AdminMenuClient({ restaurant }: Props) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    name: "",
    price: "",
    category: "",
    description: "",
    image: "",
    available: true
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "menu_items"),
      where("restaurantId", "==", restaurant.slug)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const itemsData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      })) as MenuItem[];
      setItems(itemsData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [restaurant.slug]);

  const resetForm = () => {
    setFormData({
      name: "",
      price: "",
      category: "",
      description: "",
      image: "",
      available: true
    });
    setEditingItem(null);
    setShowForm(false);
    setError(null);
  };

  const handleEdit = (item: MenuItem) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      price: item.price.toString(),
      category: item.category,
      description: item.description,
      image: item.image,
      available: item.available
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
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
        image: formData.image.trim() || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&auto=format",
        available: formData.available
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
      await updateDoc(doc(db, "menu_items", item.id), {
        available: !item.available
      });
    } catch (err) {
      console.error("Toggle failed:", err);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-10">
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
                    placeholder="e.g. 12.99"
                    className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Category *</label>
                  <input 
                    type="text"
                    value={formData.category}
                    onChange={(e) => setFormData({...formData, category: e.target.value})}
                    placeholder="e.g. Mains, Appetizers, Drinks"
                    className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none"
                  />
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Image URL</label>
                  <input 
                    type="text"
                    value={formData.image}
                    onChange={(e) => setFormData({...formData, image: e.target.value})}
                    placeholder="https://..."
                    className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none"
                  />
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
                </div>
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
              <div className="h-48 relative overflow-hidden">
                <img src={item.image} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                <div className="absolute top-4 left-4">
                  <span className="bg-white/90 backdrop-blur-sm text-[10px] font-black uppercase px-2 py-1 rounded-lg text-gray-600 border border-white">
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
                    <span className={`text-[10px] font-black uppercase px-2 ${item.available ? 'text-green-600' : 'text-red-400'}`}>
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
                      className="text-xs font-bold py-2 border rounded-xl hover:bg-gray-50 transition-colors"
                    >
                      Edit
                    </button>
                    <button 
                      onClick={() => handleDelete(item.id)}
                      className="text-xs font-bold py-2 border border-red-100 text-red-500 hover:bg-red-50 transition-colors"
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
