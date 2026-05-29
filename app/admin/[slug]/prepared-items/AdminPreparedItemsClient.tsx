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
import { Plus, Trash2, Edit2, Check, X, Sliders, ChevronDown, RefreshCw, ChefHat, Sparkles } from "lucide-react";

type PortionSize = {
  name: string;
  price: number;
};

type ModifierOption = {
  name: string;
  price: number;
};

type ModifierGroup = {
  groupName: string;
  required: boolean;
  selectionType: "single" | "multiple";
  options: ModifierOption[];
};

type PreparedItem = {
  id: string;
  name: string;
  category: string;
  price: number; // base price
  image: string;
  description: string;
  available: boolean;
  sizes: PortionSize[] | null;
  modifierGroups: ModifierGroup[] | null;
  kitchenStation: string;
  allowCustomPrice: boolean;
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

export default function AdminPreparedItemsClient({ restaurant, aiEnabled = false }: Props) {
  const [items, setItems] = useState<PreparedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<PreparedItem | null>(null);
  const [imageId, setImageId] = useState(newImageId);

  // Form State
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [available, setAvailable] = useState(true);
  const [kitchenStation, setKitchenStation] = useState("kitchen");
  const [allowCustomPrice, setAllowCustomPrice] = useState(false);

  // Portions State
  const [sizes, setSizes] = useState<PortionSize[]>([]);
  const [newSizeName, setNewSizeName] = useState("");
  const [newSizePrice, setNewSizePrice] = useState("");

  // Modifiers State
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupRequired, setNewGroupRequired] = useState(false);
  const [newGroupSelection, setNewGroupSelection] = useState<"single" | "multiple">("single");
  const [newGroupOptions, setNewGroupOptions] = useState<ModifierOption[]>([]);
  const [newOptName, setNewOptName] = useState("");
  const [newOptPrice, setNewOptPrice] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [categorySuggestions, setCategorySuggestions] = useState<string[] | null>(null);
  const [fetchingCategories, setFetchingCategories] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, "prepared_items"),
      where("restaurantId", "==", restaurant.slug)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const itemsData = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data()
      })) as PreparedItem[];
      setItems(itemsData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [restaurant.slug]);

  const resetForm = () => {
    setName("");
    setPrice("");
    setCategory("");
    setDescription("");
    setImage("");
    setAvailable(true);
    setKitchenStation("kitchen");
    setAllowCustomPrice(false);
    setSizes([]);
    setNewSizeName("");
    setNewSizePrice("");
    setModifierGroups([]);
    setNewGroupName("");
    setNewGroupRequired(false);
    setNewGroupSelection("single");
    setNewGroupOptions([]);
    setNewOptName("");
    setNewOptPrice("");
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
      // silently fail
    } finally {
      setFetchingCategories(false);
    }
  }

  const handleEdit = (item: PreparedItem) => {
    setEditingItem(item);
    setName(item.name);
    setPrice(item.price.toString());
    setCategory(item.category);
    setDescription(item.description);
    setImage(item.image);
    setAvailable(item.available);
    setKitchenStation(item.kitchenStation || "kitchen");
    setAllowCustomPrice(item.allowCustomPrice || false);
    setSizes(item.sizes || []);
    setModifierGroups(item.modifierGroups || []);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Portions Actions
  const addSize = () => {
    if (!newSizeName.trim() || !newSizePrice) return;
    const p = parseFloat(newSizePrice);
    if (isNaN(p) || p < 0) return;
    setSizes([...sizes, { name: newSizeName.trim(), price: p }]);
    setNewSizeName("");
    setNewSizePrice("");
  };

  const removeSize = (index: number) => {
    setSizes(sizes.filter((_, i) => i !== index));
  };

  // Modifier Group Option Actions
  const addOptionToNewGroup = () => {
    if (!newOptName.trim() || !newOptPrice) return;
    const p = parseFloat(newOptPrice);
    if (isNaN(p) || p < 0) return;
    setNewGroupOptions([...newGroupOptions, { name: newOptName.trim(), price: p }]);
    setNewOptName("");
    setNewOptPrice("");
  };

  const removeOptionFromNewGroup = (index: number) => {
    setNewGroupOptions(newGroupOptions.filter((_, i) => i !== index));
  };

  // Modifier Group Actions
  const saveModifierGroup = () => {
    if (!newGroupName.trim() || newGroupOptions.length === 0) {
      alert("A group must have a name and at least one option.");
      return;
    }
    setModifierGroups([
      ...modifierGroups,
      {
        groupName: newGroupName.trim(),
        required: newGroupRequired,
        selectionType: newGroupSelection,
        options: newGroupOptions
      }
    ]);
    setNewGroupName("");
    setNewGroupRequired(false);
    setNewGroupSelection("single");
    setNewGroupOptions([]);
  };

  const removeModifierGroup = (index: number) => {
    setModifierGroups(modifierGroups.filter((_, i) => i !== index));
  };

  // Submit CRUD Action
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !price || !category.trim()) {
      setError("Please fill in all required fields (Name, Price, Category).");
      return;
    }

    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 0) {
      setError("Price must be a valid non-negative number.");
      return;
    }

    try {
      const itemData = {
        restaurantId: restaurant.slug,
        name: name.trim(),
        price: priceNum,
        category: category.trim(),
        description: description.trim(),
        image: image || "",
        available,
        kitchenStation,
        allowCustomPrice,
        sizes: sizes.length > 0 ? sizes : null,
        modifierGroups: modifierGroups.length > 0 ? modifierGroups : null,
      };

      if (editingItem) {
        await updateDoc(doc(db, "prepared_items", editingItem.id), itemData);
      } else {
        await addDoc(collection(db, "prepared_items"), itemData);
      }
      resetForm();
    } catch (err) {
      console.error("Save failed:", err);
      setError("Failed to save prepared counter item. Please try again.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this prepared item?")) return;
    try {
      await deleteDoc(doc(db, "prepared_items", id));
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Failed to delete item.");
    }
  };

  const toggleAvailability = async (item: PreparedItem) => {
    try {
      await updateDoc(doc(db, "prepared_items", item.id), { available: !item.available });
    } catch (err) {
      console.error("Toggle failed:", err);
    }
  };

  const imageStoragePath = editingItem
    ? `restaurants/${restaurant.slug}/prepared-items/${editingItem.id}`
    : `restaurants/${restaurant.slug}/prepared-items/${imageId}`;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 pb-24">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2.5">
            <Sliders className="w-7 h-7 text-orange-600" />
            POS Prepared Counter Items
          </h1>
          <p className="text-gray-500 font-medium">{restaurant.name} · Counter Food Pan List</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-6 rounded-2xl transition-all transform active:scale-95 shadow-lg flex items-center gap-2"
          >
            <Plus className="w-5 h-5" strokeWidth={3} />
            Add Counter Tray Item
          </button>
        )}
      </div>

      {/* Dynamic Context Header */}
      {!showForm && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-start gap-3.5 mb-8">
          <ChefHat className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-amber-800 font-black uppercase tracking-wider">COUNTER PAN INVENTORY DECOUPLING</p>
            <p className="text-xs text-amber-700 font-medium leading-relaxed mt-0.5">
              These items represent what is physically prepared at your counter today (e.g. white rice, sides, portions). The cashier will use these individual items to dynamically build plate trays. The storefront **Online Menu** remains completely unaffected, allowing you to manage counter items and online combos independently.
            </p>
          </div>
        </div>
      )}

      {showForm && (
        <div className="bg-white border rounded-3xl p-8 shadow-sm mb-12 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-4">
            <h2 className="text-xl font-black text-gray-900">
              {editingItem ? "Edit Counter Item" : "Add New Counter Pan Item"}
            </h2>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600 font-bold flex items-center gap-1">
              <X className="w-4 h-4" /> Cancel
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Left Column: Basic Details */}
              <div className="space-y-5">
                <div>
                  <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-1.5">Item Name *</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Smoky Jollof Rice"
                    className="w-full p-3.5 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none transition-all text-sm font-medium bg-gray-50/50"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-1.5">Base Price (₦) *</label>
                    <input
                      type="number"
                      step="0.01"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="e.g. 1000"
                      className="w-full p-3.5 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none transition-all text-sm font-medium bg-gray-50/50 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-1.5">Category *</label>
                    <input
                      type="text"
                      value={category}
                      onChange={(e) => { setCategory(e.target.value); setCategorySuggestions(null); }}
                      placeholder="e.g. Rice, Mains, Proteins, Sides"
                      className="w-full p-3.5 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none transition-all text-sm font-medium bg-gray-50/50"
                    />
                  </div>
                </div>

                {aiEnabled && !categorySuggestions && (
                  <button
                    type="button"
                    onClick={suggestCategories}
                    disabled={fetchingCategories}
                    className="inline-flex items-center gap-1.5 text-xs font-black text-orange-600 hover:text-orange-700 transition-all disabled:opacity-50"
                  >
                    {fetchingCategories ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    Suggest categories with AI
                  </button>
                )}

                {categorySuggestions && categorySuggestions.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-black text-orange-500 uppercase tracking-wide">AI suggestions</p>
                    <div className="flex flex-wrap gap-1.5">
                      {categorySuggestions.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => { setCategory(cat); setCategorySuggestions(null); }}
                          className="text-xs font-bold bg-orange-50 border border-orange-200 text-orange-700 hover:bg-orange-100 px-3 py-1 rounded-xl transition-all"
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-1.5">Kitchen Station *</label>
                  <select
                    value={kitchenStation}
                    onChange={(e) => setKitchenStation(e.target.value)}
                    className="w-full p-3.5 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none transition-all text-sm font-semibold bg-gray-50/50"
                  >
                    <option value="kitchen">Main Hot Kitchen</option>
                    <option value="grill">Grill Station</option>
                    <option value="fryer">Fryer Station</option>
                    <option value="drinks">Drinks & Bar</option>
                    <option value="salad">Salad / Sides Counter</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-1.5">Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe this counter item (e.g. cooked with local peppers and spices)..."
                    rows={3}
                    className="w-full p-3.5 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none resize-none transition-all text-sm font-medium bg-gray-50/50"
                  />
                  {aiEnabled && (
                    <AiTextHelper
                      triggerLabel={description ? "Improve with AI" : "Generate with AI"}
                      endpoint="/api/admin/ai/menu-description"
                      payload={() => ({
                        itemName: name,
                        category: category || undefined,
                      })}
                      onAccept={(text) => setDescription(text)}
                    />
                  )}
                </div>

                <div className="space-y-3 bg-gray-50/50 p-4 border border-gray-100 rounded-2xl">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="available"
                      checked={available}
                      onChange={(e) => setAvailable(e.target.checked)}
                      className="w-5 h-5 accent-orange-600 rounded cursor-pointer"
                    />
                    <label htmlFor="available" className="text-sm font-bold text-gray-800 cursor-pointer select-none">Currently Available at Serving Tray</label>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="allowCustomPrice"
                      checked={allowCustomPrice}
                      onChange={(e) => setAllowCustomPrice(e.target.checked)}
                      className="w-5 h-5 accent-orange-600 rounded cursor-pointer"
                    />
                    <label htmlFor="allowCustomPrice" className="text-sm font-bold text-gray-800 cursor-pointer select-none">Allow Custom Price Override (Manager PIN gated)</label>
                  </div>
                </div>
              </div>

              {/* Right Column: Custom Sizes & Modifier Groups */}
              <div className="space-y-6">
                <ImageUpload
                  label="Item Image (Optional)"
                  value={image}
                  onChange={(url) => setImage(url)}
                  storagePath={imageStoragePath}
                  aspect="square"
                />

                {/* ── Portion Sizes Section ─────────────────────────────────── */}
                <div className="border border-gray-100 rounded-2xl p-5 bg-gray-50/20">
                  <h3 className="text-sm font-black text-gray-900 mb-3 flex items-center justify-between">
                    Portion Sizes (Optional)
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">e.g. Small / Large</span>
                  </h3>
                  
                  {sizes.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4 bg-white p-3 border border-gray-100 rounded-xl">
                      {sizes.map((s, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-orange-50 border border-orange-100 text-orange-700 text-xs font-bold px-3 py-1.5 rounded-xl">
                          <span>{s.name} (₦{s.price})</span>
                          <button type="button" onClick={() => removeSize(idx)} className="text-orange-500 hover:text-orange-700 font-bold">×</button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Size: e.g. Large Portion"
                      value={newSizeName}
                      onChange={(e) => setNewSizeName(e.target.value)}
                      className="flex-2 p-2.5 rounded-xl border border-gray-200 text-xs outline-none bg-white font-medium"
                    />
                    <input
                      type="number"
                      placeholder="Price"
                      value={newSizePrice}
                      onChange={(e) => setNewSizePrice(e.target.value)}
                      className="flex-1 p-2.5 rounded-xl border border-gray-200 text-xs outline-none bg-white font-mono"
                    />
                    <button
                      type="button"
                      onClick={addSize}
                      className="bg-gray-800 hover:bg-black text-white text-xs font-bold px-4 py-2 rounded-xl transition-all"
                    >
                      Add Size
                    </button>
                  </div>
                </div>

                {/* ── Modifier Groups Section ─────────────────────────────── */}
                <div className="border border-gray-100 rounded-2xl p-5 bg-gray-50/20">
                  <h3 className="text-sm font-black text-gray-900 mb-3">
                    Modifier Groups (Optional)
                  </h3>

                  {modifierGroups.length > 0 && (
                    <div className="space-y-2 mb-4">
                      {modifierGroups.map((g, idx) => (
                        <div key={idx} className="bg-white border border-gray-100 rounded-xl p-3.5 flex justify-between items-start gap-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-gray-900">{g.groupName}</span>
                              <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${g.required ? 'bg-amber-50 border border-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'}`}>
                                {g.required ? "Required" : "Optional"}
                              </span>
                              <span className="text-[9px] font-bold text-gray-400 uppercase">({g.selectionType})</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {g.options.map((o, oidx) => (
                                <span key={oidx} className="bg-gray-50 text-[10px] text-gray-600 border border-gray-100 px-2 py-0.5 rounded-lg">
                                  {o.name} (+₦{o.price})
                                </span>
                              ))}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeModifierGroup(idx)}
                            className="text-red-500 hover:text-red-700 shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add Group Sub-form */}
                  <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-4">
                    <p className="text-xs font-black text-gray-600 uppercase tracking-wide">Create Modifier Group</p>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text"
                        placeholder="Group Name: e.g. Protein Addons"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        className="p-2.5 rounded-xl border border-gray-200 text-xs outline-none font-semibold bg-gray-50/50"
                      />
                      <select
                        value={newGroupSelection}
                        onChange={(e) => setNewGroupSelection(e.target.value as "single" | "multiple")}
                        className="p-2.5 rounded-xl border border-gray-200 text-xs outline-none font-semibold bg-gray-50/50"
                      >
                        <option value="single">Single Choice (Radio)</option>
                        <option value="multiple">Multiple Choices (Checkboxes)</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="grpRequired"
                        checked={newGroupRequired}
                        onChange={(e) => setNewGroupRequired(e.target.checked)}
                        className="w-4 h-4 accent-orange-600 rounded"
                      />
                      <label htmlFor="grpRequired" className="text-xs font-bold text-gray-700 cursor-pointer">Cashier must select at least one option (Required)</label>
                    </div>

                    {/* Group Options Sub-list */}
                    <div className="border-t border-gray-100 pt-3">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">Group Options</p>
                      
                      {newGroupOptions.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {newGroupOptions.map((o, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 bg-gray-100 text-gray-600 text-xs font-medium px-2 py-1 rounded-xl">
                              <span>{o.name} (+₦{o.price})</span>
                              <button type="button" onClick={() => removeOptionFromNewGroup(idx)} className="text-gray-400 hover:text-gray-600 font-bold">×</button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Option Name: e.g. Extra Beef"
                          value={newOptName}
                          onChange={(e) => setNewOptName(e.target.value)}
                          className="flex-2 p-2.5 rounded-xl border border-gray-200 text-xs outline-none font-medium bg-gray-50/50"
                        />
                        <input
                          type="number"
                          placeholder="Extra Price"
                          value={newOptPrice}
                          onChange={(e) => setNewOptPrice(e.target.value)}
                          className="flex-1 p-2.5 rounded-xl border border-gray-200 text-xs outline-none font-mono bg-gray-50/50"
                        />
                        <button
                          type="button"
                          onClick={addOptionToNewGroup}
                          className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold px-3 py-2 rounded-xl transition-all"
                        >
                          Add Option
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={saveModifierGroup}
                      className="w-full bg-orange-50 border border-orange-200 hover:bg-orange-100 text-orange-700 text-xs font-black py-2.5 rounded-xl transition-all"
                    >
                      Save Modifier Group to Item
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {error && <p className="text-red-500 text-sm font-medium bg-red-50 p-4 rounded-2xl">{error}</p>}

            <div className="flex items-center gap-4 border-t border-gray-100 pt-6">
              <button
                type="submit"
                className="bg-gray-900 hover:bg-black text-white font-black py-4 px-12 rounded-2xl shadow-lg transition-all transform active:scale-95 text-sm"
              >
                {editingItem ? "Update Prepared Item" : "Create Counter Pan Item"}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="text-gray-400 hover:text-gray-600 font-bold text-sm px-4"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center font-bold text-gray-400 animate-pulse flex items-center justify-center gap-2">
          <RefreshCw className="w-5 h-5 animate-spin" /> Loading counter trays...
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-gray-200 text-center py-24 rounded-3xl p-8 flex flex-col items-center justify-center">
          <ChefHat className="w-16 h-16 text-gray-300 mb-4" />
          <p className="text-gray-500 font-black text-base">Your counter tray items list is currently empty.</p>
          <p className="text-gray-400 text-xs max-w-sm mt-1 mb-6">Create atomic prepared plates here to load them inside the POS cashier checkout screens.</p>
          <button
            onClick={() => setShowForm(true)}
            className="bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-6 rounded-2xl transition-all transform active:scale-95 shadow-md flex items-center gap-2"
          >
            <Plus className="w-5 h-5" strokeWidth={3} />
            Create First Counter Item
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((item) => (
            <div key={item.id} className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-sm flex flex-col group transition-all hover:shadow-md hover:border-orange-200">
              <div className="h-44 relative overflow-hidden bg-gray-50">
                {item.image ? (
                  <img src={item.image} alt={item.name} className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300">
                    <ChefHat className="w-12 h-12" />
                  </div>
                )}
                <div className="absolute top-4 left-4">
                  <span className="bg-white/95 backdrop-blur-sm text-[10px] font-black uppercase px-2.5 py-1 rounded-xl text-gray-600 border border-gray-100 tracking-wider shadow-sm">
                    {item.category}
                  </span>
                </div>
              </div>

              <div className="p-6 flex flex-col flex-1">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-black text-lg text-gray-900 capitalize">{item.name}</h3>
                  <span className="font-black text-orange-600 font-mono text-base">₦{item.price.toFixed(2)}</span>
                </div>
                
                <p className="text-xs text-gray-500 line-clamp-2 italic mb-4">{item.description || "No description set."}</p>

                {/* Portions & Modifiers Summary Badges */}
                <div className="space-y-2.5 mb-5 border-t border-gray-100 pt-4">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-black uppercase text-gray-400 tracking-wider shrink-0">Sizes:</span>
                    {item.sizes && item.sizes.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {item.sizes.map((s, idx) => (
                          <span key={idx} className="bg-orange-50 border border-orange-100 text-orange-700 text-[9px] font-bold px-2 py-0.5 rounded-lg">
                            {s.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[10px] text-gray-400 italic">Base size only</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-black uppercase text-gray-400 tracking-wider shrink-0">Modifiers:</span>
                    {item.modifierGroups && item.modifierGroups.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {item.modifierGroups.map((g, idx) => (
                          <span key={idx} className="bg-gray-100 border border-gray-200/50 text-gray-600 text-[9px] font-bold px-2 py-0.5 rounded-lg">
                            {g.groupName} ({g.options.length})
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[10px] text-gray-400 italic">No modifiers</span>
                    )}
                  </div>
                </div>

                <div className="mt-auto space-y-4">
                  <div className="flex justify-between items-center bg-gray-50 p-2.5 rounded-2xl border border-gray-100">
                    <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-xl ${item.available ? 'bg-green-50 border border-green-100 text-green-700' : 'bg-red-50 border border-red-100 text-red-700'}`}>
                      {item.available ? "Serving Pans Active" : "Sold Out"}
                    </span>
                    <button
                      onClick={() => toggleAvailability(item)}
                      className={`relative w-10 h-6 flex items-center rounded-full transition-all ${item.available ? 'bg-orange-600' : 'bg-gray-300'}`}
                    >
                      <div className={`w-4 h-4 bg-white rounded-full mx-1 transition-transform ${item.available ? 'translate-x-4' : 'translate-x-0'}`}></div>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleEdit(item)}
                      className="text-xs font-bold py-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-colors flex items-center justify-center gap-1"
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Edit Pan
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="text-xs font-bold py-2.5 border border-red-100 text-red-500 hover:bg-red-50 hover:border-red-200 transition-colors rounded-xl flex items-center justify-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
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
