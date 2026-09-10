import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { BackLink } from '../../components/BackLink'

interface Customer {
  id: string
  code: string
  shop_name: string
  contact_name: string | null
  phone: string | null
  area: string | null
  is_active: boolean
}

// SPEC.md Section 10.4: shop directory. Read is wide (p_cust_read using
// true); write requires order_taker or supervisor/owner (p_cust_write).
export function Customers() {
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const [shopName, setShopName] = useState('')
  const [contactName, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [area, setArea] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: customers, isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, code, shop_name, contact_name, phone, area, is_active')
        .order('shop_name')
      if (error) throw error
      return data as Customer[]
    },
  })

  const addCustomer = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('customers').insert({
        code,
        shop_name: shopName,
        contact_name: contactName || null,
        phone: phone || null,
        area: area || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setCode('')
      setShopName('')
      setContactName('')
      setPhone('')
      setArea('')
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['customers'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="p-4 space-y-4">
      <BackLink to="/" label="Home" />
      <h1 className="text-xl font-semibold">Customers</h1>

      {isLoading && <p className="text-slate-400">Loading…</p>}

      <div className="space-y-2">
        {customers?.map((c) => (
          <div key={c.id} className="rounded-lg bg-slate-800 p-3">
            <p className="font-medium">{c.shop_name}</p>
            <p className="text-sm text-slate-400">
              {c.code}
              {c.area ? ` · ${c.area}` : ''}
              {c.phone ? ` · ${c.phone}` : ''}
            </p>
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t border-slate-800 pt-4">
        <p className="font-medium">Add a shop</p>
        <input
          placeholder="Code"
          className="w-full h-touch rounded-lg bg-slate-800 px-3"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <input
          placeholder="Shop name"
          className="w-full h-touch rounded-lg bg-slate-800 px-3"
          value={shopName}
          onChange={(e) => setShopName(e.target.value)}
        />
        <input
          placeholder="Contact name (optional)"
          className="w-full h-touch rounded-lg bg-slate-800 px-3"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
        />
        <input
          placeholder="Phone (optional)"
          className="w-full h-touch rounded-lg bg-slate-800 px-3"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <input
          placeholder="Area (optional)"
          className="w-full h-touch rounded-lg bg-slate-800 px-3"
          value={area}
          onChange={(e) => setArea(e.target.value)}
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          className="w-full h-touch rounded-lg bg-blue-600 font-medium disabled:opacity-50"
          disabled={!code || !shopName || addCustomer.isPending}
          onClick={() => addCustomer.mutate()}
        >
          {addCustomer.isPending ? 'Saving…' : 'Add shop'}
        </button>
      </div>
    </div>
  )
}
