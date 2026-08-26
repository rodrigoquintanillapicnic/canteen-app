import { createClient } from '@supabase/supabase-js';

// Get these exact values from Supabase Project Settings -> API
const supabaseUrl = 'https://povpzctwxphvkczoxtma.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvdnB6Y3R3eHBodmtjem94dG1hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMDU4MDAsImV4cCI6MjEwMjg4MTgwMH0.RQ9VG_J0Hlqxi66Q2ag_0OynDilAEWO389lXLzNZ4jw';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    headers: {
      'Cache-Control': 'no-cache',
    },
  },
});

export async function logCanteenAction(
  productName: string,
  actionType: 'ADD' | 'REMOVE' | 'STOCK_UPDATE' | 'PRICE_UPDATE',
  quantityChange: number,
  newStockLevel: number
) {
  const { error } = await supabase.from('canteen_logs').insert([
    {
      product_name: productName,
      action_type: actionType,
      quantity_change: quantityChange,
      new_stock_level: newStockLevel,
    },
  ]);

  if (error) console.error('Failed to write log:', error.message);
}