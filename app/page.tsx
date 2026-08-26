'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase, logCanteenAction } from './supabase';
import BarcodeScanner from './BarcodeScanner';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid
} from 'recharts';

interface Product {
  id: string;
  Name: string;
  PN_Category_Level_1__c?: string;
  "Image Link"?: string;
  image_link?: string;
  image_url?: string;
  image?: string;
  barcode?: string;
}

interface CanteenItem {
  id: string;
  product_id: string;
  current_stock: number;
  min_threshold: number;
  daily_consumption: number;
  price: number;
  products: Product;
}

interface CanteenLog {
  id: string;
  created_at: string;
  product_name: string;
  action_type: string;
  quantity_change: number;
  new_stock_level: number;
}

const ITEMS_PER_PAGE = 24;

const getStockBadge = (stock: number, min: number) => {
  if (stock === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-red-50 text-red-600 border border-red-200">
        <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse"></span>
        Out of Stock
      </span>
    );
  }
  if (stock <= min) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
        Low Stock
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
      Healthy
    </span>
  );
};

export default function InventoryDashboard() {
  const [activeTab, setActiveTab] = useState<'inventory' | 'catalog' | 'restock' | 'logs' | 'analytics'>('catalog');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [bindingProductId, setBindingProductId] = useState<string | null>(null);
  const [tempBarcode, setTempBarcode] = useState('');
  const [dbError, setDbError] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  // Master Catalog State
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>(['All']);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Active Canteen Inventory State
  const [canteenItems, setCanteenItems] = useState<CanteenItem[]>([]);
  const [stockFilter, setStockFilter] = useState<'ALL' | 'LOW' | 'OUT' | 'HEALTHY'>('ALL');

  // Audit Logs State
  const [logs, setLogs] = useState<CanteenLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Search Recommendations
  const [recommendations, setRecommendations] = useState<Product[]>([]);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const getProductImage = (p?: Product) => {
    if (!p) return null;
    return p["Image Link"] || p.image_link || p.image_url || p.image || null;
  };

  const handleImageError = (id: string) => {
    setImageErrors((prev) => ({ ...prev, [id]: true }));
  };

  useEffect(() => {
    async function fetchCategories() {
      const { data, error } = await supabase
        .from('products')
        .select('PN_Category_Level_1__c')
        .not('PN_Category_Level_1__c', 'is', null)
        .limit(2000);

      if (error) {
        setDbError(`Category Fetch Error: ${error.message}`);
      } else if (data) {
        const unique = Array.from(
          new Set(data.map((item: any) => item.PN_Category_Level_1__c))
        ).filter(Boolean) as string[];
        setCategories(['All', ...unique.sort()]);
      }
    }
    fetchCategories();
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setShowRecommendations(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handler = setTimeout(async () => {
      setDebouncedSearch(searchTerm);
      setPage(1);

      if (searchTerm.trim().length >= 2) {
        const { data } = await supabase
          .from('products')
          .select('*')
          .not('Name', 'is', null)
          .or(`Name.ilike.%${searchTerm.trim()}%,barcode.eq.${searchTerm.trim()},PN_Article_Id__c.eq.${searchTerm.trim()}`)
          .limit(5);

        setRecommendations(data || []);
        setShowRecommendations(true);
      } else {
        setRecommendations([]);
        setShowRecommendations(false);
      }
    }, 250);

    return () => clearTimeout(handler);
  }, [searchTerm]);

  const fetchCanteenInventory = useCallback(async () => {
    const { data, error } = await supabase
      .from('canteen_inventory')
      .select(`
        id,
        current_stock,
        min_threshold,
        daily_consumption,
        price,
        product_id,
        products (*)
      `);

    if (error) {
      console.error('Fetch Inventory Error:', error.message);
      return;
    }

    if (data) {
      const formatted = data.map((item: any) => ({
        ...item,
        min_threshold: item.min_threshold ?? 3,
        daily_consumption: item.daily_consumption ?? 1.0,
        price: item.price ?? 0.00,
      }));
      setCanteenItems(formatted);
    }
  }, []);

  const fetchAuditLogs = useCallback(async () => {
    setLogsLoading(true);
    const { data, error } = await supabase
      .from('canteen_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (!error && data) {
      setLogs(data);
    }
    setLogsLoading(false);
  }, []);

  const fetchProducts = useCallback(async () => {
    if (activeTab !== 'catalog') return;
    setLoading(true);
    setDbError(null);
    const from = (page - 1) * ITEMS_PER_PAGE;
    const to = from + ITEMS_PER_PAGE - 1;

    let query = supabase
      .from('products')
      .select('*', { count: 'exact' })
      .not('Name', 'is', null);

    if (selectedCategory && selectedCategory !== 'All') {
      query = query.eq('PN_Category_Level_1__c', selectedCategory);
    }
    if (debouncedSearch.trim() !== '') {
      query = query.or(`Name.ilike.%${debouncedSearch.trim()}%,barcode.eq.${debouncedSearch.trim()},PN_Article_Id__c.eq.${debouncedSearch.trim()}`);
    }

    const { data, count, error } = await query.range(from, to);

    if (error) {
      setDbError(`Catalog Error: ${error.message}`);
      setProducts([]);
    } else {
      setProducts(data || []);
      setTotalCount(count || 0);
    }
    setLoading(false);
  }, [page, selectedCategory, debouncedSearch, activeTab]);

  useEffect(() => {
    fetchCanteenInventory();
  }, [fetchCanteenInventory]);

  useEffect(() => {
    if (activeTab === 'catalog') fetchProducts();
    if (activeTab === 'logs') fetchAuditLogs();
  }, [fetchProducts, fetchAuditLogs, activeTab]);

  const saveBarcodeBinding = async (productId: string, codeToSave: string) => {
    if (!codeToSave.trim()) return;

    const { error } = await supabase
      .from('products')
      .update({ barcode: codeToSave.trim() })
      .eq('id', productId);

    if (!error) {
      setProducts((prev) =>
        prev.map((p) => (p.id === productId ? { ...p, barcode: codeToSave.trim() } : p))
      );
      setBindingProductId(null);
      setTempBarcode('');
    } else {
      alert(`Failed to save barcode: ${error.message}`);
    }
  };

  const handleBarcodeScan = async (scannedBarcode: string) => {
    setIsScannerOpen(false);
    setActiveTab('catalog');
    setSearchTerm(scannedBarcode);
  };

  const handleAddToCanteen = async (product: Product) => {
    const existingItem = canteenItems.find((item) => item.product_id === product.id);

    if (existingItem) {
      const newStock = existingItem.current_stock + 1;
      const { error } = await supabase
        .from('canteen_inventory')
        .update({ current_stock: newStock })
        .eq('id', existingItem.id);

      if (!error) {
        setCanteenItems((prev) =>
          prev.map((item) =>
            item.product_id === product.id ? { ...item, current_stock: newStock } : item
          )
        );
        logCanteenAction(product.Name || 'Unnamed Product', 'STOCK_UPDATE', 1, newStock);
      }
    } else {
      const initialPrice = 0.00;
      const { data, error } = await supabase
        .from('canteen_inventory')
        .insert([{
          product_id: product.id,
          current_stock: 1,
          min_threshold: 3,
          daily_consumption: 1.0,
          price: initialPrice
        }])
        .select('id, current_stock, min_threshold, daily_consumption, price');

      if (!error && data && data.length > 0) {
        const newItem: CanteenItem = {
          id: data[0].id,
          product_id: product.id,
          current_stock: data[0].current_stock,
          min_threshold: data[0].min_threshold ?? 3,
          daily_consumption: data[0].daily_consumption ?? 1.0,
          price: data[0].price ?? initialPrice,
          products: product,
        };
        setCanteenItems((prev) => [...prev, newItem]);
        logCanteenAction(product.Name || 'Unnamed Product', 'ADD', 1, 1);
      }
    }
  };

  const handleRemoveFromCanteen = async (canteenId: string, productName: string) => {
    setCanteenItems((prev) => prev.filter((item) => item.id !== canteenId));
    await supabase.from('canteen_inventory').delete().eq('id', canteenId);
    logCanteenAction(productName, 'REMOVE', 0, 0);
  };

  const handleUpdateStock = async (canteenId: string, productName: string, newStock: number, currentStock: number) => {
    const updatedStock = Math.max(0, newStock);
    const diff = updatedStock - currentStock;
    setCanteenItems((prev) =>
      prev.map((item) => (item.id === canteenId ? { ...item, current_stock: updatedStock } : item))
    );
    await supabase.from('canteen_inventory').update({ current_stock: updatedStock }).eq('id', canteenId);
    logCanteenAction(productName, 'STOCK_UPDATE', diff, updatedStock);
  };

  const handleUpdateMinThreshold = async (canteenId: string, newMin: number) => {
    const updatedMin = Math.max(0, newMin);
    setCanteenItems((prev) =>
      prev.map((item) => (item.id === canteenId ? { ...item, min_threshold: updatedMin } : item))
    );
    await supabase.from('canteen_inventory').update({ min_threshold: updatedMin }).eq('id', canteenId);
  };

  const handleUpdateDailyRate = async (canteenId: string, newRate: number) => {
    const updatedRate = Math.max(0.1, Math.round(newRate * 10) / 10);
    setCanteenItems((prev) =>
      prev.map((item) => (item.id === canteenId ? { ...item, daily_consumption: updatedRate } : item))
    );
    await supabase.from('canteen_inventory').update({ daily_consumption: updatedRate }).eq('id', canteenId);
  };

  const handleUpdatePrice = async (canteenId: string, productName: string, newPrice: number) => {
    const updatedPrice = Math.max(0, Math.round(newPrice * 100) / 100);
    setCanteenItems((prev) =>
      prev.map((item) => (item.id === canteenId ? { ...item, price: updatedPrice } : item))
    );
    await supabase.from('canteen_inventory').update({ price: updatedPrice }).eq('id', canteenId);
    logCanteenAction(productName, 'PRICE_UPDATE', 0, 0);
  };

  const restockItems = canteenItems.filter((item) => item.current_stock <= item.min_threshold);
  const calculateTotalValuation = () => canteenItems.reduce((acc, item) => acc + (item.current_stock * (item.price || 0)), 0);
  const calculateDailyBurnRate = () => canteenItems.reduce((acc, item) => acc + (item.daily_consumption * (item.price || 0)), 0);

  const categoryChartData = canteenItems.reduce((acc: { [key: string]: { category: string; value: number } }, item) => {
    const cat = item.products?.PN_Category_Level_1__c || 'General';
    const itemValue = item.current_stock * item.price;
    if (!acc[cat]) acc[cat] = { category: cat, value: 0 };
    acc[cat].value += itemValue;
    return acc;
  }, {});

  const chartData = Object.values(categoryChartData);
  const CHART_COLORS = ['#E30613', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

  const filteredCanteenItems = canteenItems.filter((item) => {
    if (stockFilter === 'OUT') return item.current_stock === 0;
    if (stockFilter === 'LOW') return item.current_stock > 0 && item.current_stock <= item.min_threshold;
    if (stockFilter === 'HEALTHY') return item.current_stock > item.min_threshold;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));

  return (
    <main className="min-h-screen bg-[#F4F5F7] text-slate-900 pb-16">
      {isScannerOpen && (
        <BarcodeScanner
          onScan={handleBarcodeScan}
          onClose={() => setIsScannerOpen(false)}
        />
      )}

      {/* Header Bar */}
      <header className="bg-[#E30613] text-white shadow-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-3 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-white p-1 rounded-xl shadow-sm flex items-center justify-center overflow-hidden">
              <img 
                src="/picnic-logo.png" 
                alt="Picnic Truck Logo" 
                className="h-12 w-auto object-contain rounded-lg"
              />
            </div>
            <div>
              <h1 className="text-xl font-bold leading-tight">Canteen Hub</h1>
              <p className="text-xs text-red-100 font-medium">Real-time inventory management</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsScannerOpen(true)}
              className="px-4 py-2 bg-white text-[#E30613] hover:bg-red-50 text-sm font-bold rounded-xl shadow-sm transition flex items-center gap-2"
            >
              📷 Camera Scan
            </button>

            {/* Navigation Pills */}
            <nav className="flex bg-black/15 p-1 rounded-xl gap-1 backdrop-blur-sm">
              <button
                onClick={() => { setActiveTab('inventory'); fetchCanteenInventory(); }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                  activeTab === 'inventory' ? 'bg-white text-[#E30613] shadow-sm' : 'text-white hover:bg-white/10'
                }`}
              >
                Active Stock ({canteenItems.length})
              </button>
              <button
                onClick={() => setActiveTab('restock')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                  activeTab === 'restock' ? 'bg-white text-[#E30613] shadow-sm' : 'text-white hover:bg-white/10'
                }`}
              >
                📋 Restock
                {restockItems.length > 0 && (
                  <span className="bg-amber-400 text-slate-900 text-[10px] px-1.5 py-0.2 rounded-full font-black">
                    {restockItems.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('analytics')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                  activeTab === 'analytics' ? 'bg-white text-[#E30613] shadow-sm' : 'text-white hover:bg-white/10'
                }`}
              >
                📊 Analytics
              </button>
              <button
                onClick={() => setActiveTab('logs')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                  activeTab === 'logs' ? 'bg-white text-[#E30613] shadow-sm' : 'text-white hover:bg-white/10'
                }`}
              >
                📜 Audit Logs
              </button>
              <button
                onClick={() => setActiveTab('catalog')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                  activeTab === 'catalog' ? 'bg-white text-[#E30613] shadow-sm' : 'text-white hover:bg-white/10'
                }`}
              >
                Master Catalog
              </button>
            </nav>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 mt-6 space-y-6">
        {dbError && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 font-semibold rounded-2xl shadow-sm text-sm">
            🚨 <strong>Supabase Error:</strong> {dbError}
          </div>
        )}

        {/* Metric Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm transition hover:shadow-md">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Stock Value</span>
            <div className="text-3xl font-extrabold text-slate-900 mt-1">€{calculateTotalValuation().toFixed(2)}</div>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm transition hover:shadow-md">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Estimated Daily Burn</span>
            <div className="text-3xl font-extrabold text-[#E30613] mt-1">€{calculateDailyBurnRate().toFixed(2)} <span className="text-xs font-bold text-slate-400">/ day</span></div>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm transition hover:shadow-md">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Items to Reorder</span>
            <div className="text-3xl font-extrabold text-amber-600 mt-1">{restockItems.length} Items</div>
          </div>
        </div>

        {/* Analytics Tab */}
        {activeTab === 'analytics' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Stock Valuation by Category (€)</h2>
            {chartData.length === 0 ? (
              <div className="text-center py-12 text-slate-400">Add products to Active Inventory to view category charts.</div>
            ) : (
              <div className="h-72 w-full pt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="category" tick={{ fontSize: 12, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#64748b' }} unit="€" />
                    <Tooltip formatter={(val: any) => [`€${Number(val).toFixed(2)}`, 'Valuation']} />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                      {chartData.map((_, idx) => (
                        <Cell key={`cell-${idx}`} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* Active Stock Tab */}
        {activeTab === 'inventory' && (
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mr-2">Filter:</span>
              {[
                { label: 'All Items', value: 'ALL' },
                { label: '⚠️ Low Stock', value: 'LOW' },
                { label: '🚨 Out of Stock', value: 'OUT' },
                { label: '✅ Healthy', value: 'HEALTHY' }
              ].map((f) => (
                <button
                  key={f.value}
                  onClick={() => setStockFilter(f.value as any)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition ${
                    stockFilter === f.value
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {filteredCanteenItems.length === 0 ? (
              <div className="text-center py-16 text-slate-400 bg-white rounded-2xl border border-slate-200/80 shadow-sm">
                No active items found. Select items from the Master Catalog!
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {filteredCanteenItems.map((item) => {
                  const p = item.products;
                  const imageUrl = getProductImage(p);
                  const isImageBroken = imageErrors[item.id];

                  return (
                    <div
                      key={item.id}
                      className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between relative group"
                    >
                      <button
                        onClick={() => handleRemoveFromCanteen(item.id, p?.Name || 'Product')}
                        className="absolute top-3 right-3 z-10 w-7 h-7 bg-white text-slate-400 hover:text-[#E30613] hover:bg-red-50 rounded-full border border-slate-200 font-bold text-xs flex items-center justify-center transition shadow-sm"
                        title="Remove Item"
                      >
                        ✕
                      </button>

                      <div>
                        <div className="relative h-40 w-full mb-4 flex items-center justify-center bg-slate-50 rounded-xl overflow-hidden p-2 group-hover:scale-[1.02] transition-transform">
                          {imageUrl && !isImageBroken ? (
                            <img
                              src={imageUrl}
                              alt={p?.Name || 'Product Image'}
                              className="h-full w-full object-contain p-2"
                              onError={() => handleImageError(item.id)}
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center text-slate-300 gap-1">
                              <span className="text-2xl">📦</span>
                              <span className="text-[11px] font-medium text-slate-400">No Image Available</span>
                            </div>
                          )}
                        </div>
                        
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-bold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg truncate">
                            {p?.PN_Category_Level_1__c || 'General'}
                          </span>
                          {getStockBadge(item.current_stock, item.min_threshold)}
                        </div>

                        <h3 className="font-bold text-slate-900 mt-2 line-clamp-2 leading-tight pr-4">{p?.Name || 'Unnamed Product'}</h3>
                      </div>
                      
                      <div className="mt-5 pt-4 border-t border-slate-100 space-y-4">
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                            <span className="text-slate-400 text-[9px] font-bold uppercase block">Price (€)</span>
                            <input
                              type="number"
                              step="0.01"
                              value={item.price}
                              onChange={(e) => handleUpdatePrice(item.id, p?.Name || 'Product', parseFloat(e.target.value) || 0)}
                              className="w-full mt-0.5 bg-transparent font-bold text-slate-900 focus:outline-none"
                            />
                          </div>
                          <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                            <span className="text-slate-400 text-[9px] font-bold uppercase block">Min Stock</span>
                            <input
                              type="number"
                              value={item.min_threshold}
                              onChange={(e) => handleUpdateMinThreshold(item.id, parseInt(e.target.value) || 0)}
                              className="w-full mt-0.5 bg-transparent font-bold text-slate-900 focus:outline-none"
                            />
                          </div>
                          <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                            <span className="text-slate-400 text-[9px] font-bold uppercase block">Daily Use</span>
                            <input
                              type="number"
                              step="0.1"
                              value={item.daily_consumption}
                              onChange={(e) => handleUpdateDailyRate(item.id, parseFloat(e.target.value) || 0.1)}
                              className="w-full mt-0.5 bg-transparent font-bold text-slate-900 focus:outline-none"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between bg-slate-50 p-2 rounded-xl border border-slate-100">
                          <span className="text-xs font-extrabold text-slate-700 ml-1">Current Stock:</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleUpdateStock(item.id, p?.Name || 'Product', item.current_stock - 1, item.current_stock)}
                              className="w-7 h-7 bg-white hover:bg-slate-200 text-slate-900 rounded-lg font-black text-sm border border-slate-200 shadow-sm transition"
                            >
                              -
                            </button>
                            <span className="font-black text-slate-900 text-sm px-1">{item.current_stock}</span>
                            <button
                              onClick={() => handleUpdateStock(item.id, p?.Name || 'Product', item.current_stock + 1, item.current_stock)}
                              className="w-7 h-7 bg-[#E30613] hover:bg-red-700 text-white rounded-lg font-black text-sm shadow-sm transition"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Restock Tab */}
        {activeTab === 'restock' && (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 space-y-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">Recommended Restock Orders</h2>
            {restockItems.length === 0 ? (
              <div className="text-center py-16 text-slate-400">🎉 All inventory stock levels are healthy!</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-700">
                  <thead className="bg-slate-50 uppercase text-[10px] font-extrabold text-slate-400 tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Item Name</th>
                      <th className="py-3 px-4 text-center">Current Stock</th>
                      <th className="py-3 px-4 text-center">Min Threshold</th>
                      <th className="py-3 px-4 text-center">Recommended Order</th>
                      <th className="py-3 px-4 text-right">Unit Price</th>
                      <th className="py-3 px-4 text-right">Est. Total Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {restockItems.map((item) => {
                      const needed = Math.max(1, (item.min_threshold * 2) - item.current_stock);
                      return (
                        <tr key={item.id} className="hover:bg-slate-50 transition">
                          <td className="py-3.5 px-4 font-bold text-slate-900">{item.products?.Name || 'Unnamed Item'}</td>
                          <td className="py-3.5 px-4 text-center font-black text-red-600">{item.current_stock}</td>
                          <td className="py-3.5 px-4 text-center">{item.min_threshold}</td>
                          <td className="py-3.5 px-4 text-center font-bold text-emerald-600">+{needed} units</td>
                          <td className="py-3.5 px-4 text-right">€{item.price.toFixed(2)}</td>
                          <td className="py-3.5 px-4 text-right font-black text-slate-900">€{(needed * item.price).toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Audit Logs Tab */}
        {activeTab === 'logs' && (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 space-y-4 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">System Activity Audit Log</h2>
            {logsLoading ? (
              <div className="text-center py-12 text-slate-400">Loading audit history...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-700">
                  <thead className="bg-slate-50 uppercase text-[10px] font-extrabold text-slate-400 tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">Product Name</th>
                      <th className="py-3 px-4">Action</th>
                      <th className="py-3 px-4 text-center">Quantity Change</th>
                      <th className="py-3 px-4 text-center">New Stock Level</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50 transition">
                        <td className="py-3.5 px-4 text-slate-400 text-xs">{new Date(log.created_at).toLocaleString()}</td>
                        <td className="py-3.5 px-4 font-bold text-slate-900">{log.product_name}</td>
                        <td className="py-3.5 px-4">
                          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                            {log.action_type}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center font-bold">{log.quantity_change}</td>
                        <td className="py-3.5 px-4 text-center font-black text-slate-900">{log.new_stock_level}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Master Catalog Tab */}
        {activeTab === 'catalog' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-200 flex-1">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => { setSelectedCategory(cat); setPage(1); }}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                      selectedCategory === cat
                        ? 'bg-[#E30613] text-white shadow-sm'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="relative" ref={searchContainerRef}>
                <input
                  type="text"
                  placeholder="Search catalog or scan barcode..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full md:w-80 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#E30613]/20 shadow-sm"
                />

                {showRecommendations && recommendations.length > 0 && (
                  <div className="absolute top-full mt-2 w-full bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden divide-y divide-slate-100">
                    {recommendations.map((rec) => (
                      <button
                        key={rec.id}
                        onClick={() => {
                          setSearchTerm(rec.Name);
                          setShowRecommendations(false);
                        }}
                        className="w-full text-left p-3 hover:bg-slate-50 transition flex items-center justify-between"
                      >
                        <span className="text-xs font-bold text-slate-800 truncate">{rec.Name}</span>
                        <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-semibold">
                          {rec.PN_Category_Level_1__c || 'Catalog'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {loading ? (
              <div className="text-center py-20 text-slate-400">Loading catalog items...</div>
            ) : products.length === 0 ? (
              <div className="text-center py-20 text-slate-400 bg-white rounded-2xl border border-slate-200/80 shadow-sm">
                No matching products found in the catalog.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {products.map((p) => {
                  const isInInventory = canteenItems.some((item) => item.product_id === p.id);
                  const imageUrl = getProductImage(p);
                  const isImageBroken = imageErrors[p.id];

                  return (
                    <div
                      key={p.id}
                      className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"
                    >
                      <div>
                        <div className="relative h-40 w-full mb-4 flex items-center justify-center bg-slate-50 rounded-xl overflow-hidden p-2">
                          {imageUrl && !isImageBroken ? (
                            <img
                              src={imageUrl}
                              alt={p.Name || 'Product Image'}
                              className="h-full w-full object-contain p-2"
                              onError={() => handleImageError(p.id)}
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center text-slate-300 gap-1">
                              <span className="text-2xl">📦</span>
                              <span className="text-[11px] font-medium text-slate-400">No Image Available</span>
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md">
                          {p.PN_Category_Level_1__c || 'General'}
                        </span>
                        <h3 className="font-bold text-slate-900 mt-2 line-clamp-2 leading-tight text-sm">{p.Name}</h3>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
                        {bindingProductId === p.id ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              placeholder="Barcode value..."
                              value={tempBarcode}
                              autoFocus
                              onChange={(e) => setTempBarcode(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveBarcodeBinding(p.id, tempBarcode);
                                if (e.key === 'Escape') { setBindingProductId(null); setTempBarcode(''); }
                              }}
                              className="w-full px-2 py-1 text-xs border rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                            <button
                              onClick={() => saveBarcodeBinding(p.id, tempBarcode)}
                              className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => { setBindingProductId(null); setTempBarcode(''); }}
                              className="px-2 py-1 bg-slate-100 text-slate-500 rounded-lg text-xs font-bold hover:bg-slate-200 transition"
                              title="Cancel editing"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between text-xs text-slate-400">
                            <span>Barcode: {p.barcode || 'None'}</span>
                            <button
                              onClick={() => { setBindingProductId(p.id); setTempBarcode(p.barcode || ''); }}
                              className="text-[#E30613] font-bold hover:underline"
                            >
                              Edit
                            </button>
                          </div>
                        )}

                        <button
                          onClick={() => handleAddToCanteen(p)}
                          className={`w-full py-2 rounded-xl text-xs font-bold transition ${
                            isInInventory
                              ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                              : 'bg-[#E30613] text-white hover:bg-red-700 shadow-sm'
                          }`}
                        >
                          {isInInventory ? 'Add Another Unit' : '+ Add to Canteen'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pagination Controls */}
            <div className="flex items-center justify-between border-t border-slate-200 pt-4">
              <span className="text-xs font-semibold text-slate-500">
                Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  disabled={page === 1}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  className="px-3 py-1.5 bg-white border border-slate-200 text-xs font-bold rounded-xl disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((prev) => prev + 1)}
                  className="px-3 py-1.5 bg-white border border-slate-200 text-xs font-bold rounded-xl disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}