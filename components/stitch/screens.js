"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";

function dinheiro(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(number);
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function withTimeout(promise, label, timeoutMs = 20000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Tempo limite excedido em ${label}.`)), timeoutMs);
    })
  ]);
}

const SIZE_OPTIONS = {
  letras: ["PP", "P", "M", "G", "GG"],
  numeros: ["34", "36", "38", "40", "42", "44", "46"]
};

const CART_STORAGE_KEY = "malustore_cart_v1";
const INSTAGRAM_URL = "https://www.instagram.com/";

function readCartItems() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCartItems(items) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event("malustore:cart-updated"));
}

function getCartCount(items) {
  return items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function useCart() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    setItems(readCartItems());

    function syncCart() {
      setItems(readCartItems());
    }

    window.addEventListener("storage", syncCart);
    window.addEventListener("malustore:cart-updated", syncCart);
    return () => {
      window.removeEventListener("storage", syncCart);
      window.removeEventListener("malustore:cart-updated", syncCart);
    };
  }, []);

  const count = useMemo(() => getCartCount(items), [items]);

  function updateItems(nextItems) {
    writeCartItems(nextItems);
    setItems(nextItems);
  }

  return { items, count, updateItems };
}

function normalizeSizeStock(sizeStock) {
  if (!sizeStock || typeof sizeStock !== "object") return {};
  const normalized = {};
  for (const [size, rawValue] of Object.entries(sizeStock)) {
    const parsedValue = Math.floor(Number(rawValue || 0));
    normalized[size] = Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0;
  }
  return normalized;
}

function getTotalProductStock(product) {
  const sizeStock = normalizeSizeStock(product?.size_stock);
  const stockBySize = Object.values(sizeStock).reduce((sum, value) => sum + value, 0);
  const fallbackStock = Math.max(0, Math.floor(Number(product?.stock || 0)));
  return Math.max(stockBySize, fallbackStock);
}

function getSizeStock(product, size) {
  if (!size) return getTotalProductStock(product);
  const sizeStock = normalizeSizeStock(product?.size_stock);
  if (Object.prototype.hasOwnProperty.call(sizeStock, size)) {
    return sizeStock[size];
  }
  return getTotalProductStock(product);
}

function getCartItemKey(item) {
  return `${item.productId ?? item.id ?? "item"}::${item.size || "unico"}`;
}

function useAuthContext() {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const refreshProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null);
      return null;
    }

    const { data: profileData } = await supabase
      .from("profiles")
      .select("id,full_name,role,phone")
      .eq("id", userId)
      .single();

    setProfile(profileData || null);
    return profileData || null;
  }, [supabase]);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        const { data: sessionData } = await supabase.auth.getSession();
        let currentUser = sessionData.session?.user || null;

        if (!currentUser) {
          const { data: userData } = await supabase.auth.getUser();
          currentUser = userData.user || null;
        }

        if (!active) return;

        setUser(currentUser);

        if (!currentUser) {
          setProfile(null);
          return;
        }

        const profileData = await refreshProfile(currentUser.id);
        if (!active) return;
        setProfile(profileData || null);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const currentUser = session?.user || null;
      setUser(currentUser);

      if (!currentUser) {
        setProfile(null);
        return;
      }

      await refreshProfile(currentUser.id);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase, refreshProfile]);

  return {
    supabase,
    user,
    profile,
    role: profile?.role || "customer",
    loading,
    refreshProfile
  };
}

function ProfileDrawer({ user, profile, role, open, onClose, onLogout, supabase, onProfileUpdated }) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFullName(profile?.full_name || "");
    setPhone(profile?.phone || "");
    setMessage("");
    setEditing(false);
  }, [open]);

  async function handleSaveProfile(event) {
    event.preventDefault();
    if (!user || saving) return;

    try {
      setSaving(true);
      setMessage("");

      const { error } = await supabase.from("profiles").upsert({
        id: user.id,
        full_name: fullName || null,
        phone: phone || null
      });

      if (error) {
        setMessage(`Erro ao atualizar perfil: ${error.message}`);
        return;
      }

      if (onProfileUpdated) onProfileUpdated(user.id);
      setMessage("Perfil atualizado com sucesso.");
      setEditing(false);
    } catch (error) {
      setMessage(`Erro inesperado ao atualizar perfil: ${error.message || "falha desconhecida"}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {open ? <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} /> : null}
      <aside className={`fixed right-0 top-0 z-50 h-full w-[340px] bg-white p-6 shadow-2xl transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-serifDisplay text-3xl">Perfil</h2>
          <button className="rounded border border-zinc-300 px-2 py-1 text-xs" onClick={onClose}>Fechar</button>
        </div>

        {user ? (
          <div className="space-y-4 text-sm">
            {!editing ? (
              <div className="space-y-3">
                <div>
                  <p className="text-zinc-500">Nome</p>
                  <p className="font-medium text-zinc-900">{profile?.full_name || "Nao informado"}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Telefone</p>
                  <p className="font-medium text-zinc-900">{profile?.phone || "Nao informado"}</p>
                </div>
                <button
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-300"
                  onClick={() => setEditing(true)}
                  title="Editar dados"
                  aria-label="Editar dados"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </svg>
                </button>
              </div>
            ) : (
              <form className="space-y-3" onSubmit={handleSaveProfile}>
                <div>
                  <p className="text-zinc-500">Nome</p>
                  <input
                    className="mt-1 w-full rounded border border-zinc-300 px-3 py-2"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Nome completo"
                  />
                </div>
                <div>
                  <p className="text-zinc-500">Telefone</p>
                  <input
                    className="mt-1 w-full rounded border border-zinc-300 px-3 py-2"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="(11) 99999-9999"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="w-full rounded border border-zinc-300 py-2 text-xs font-semibold uppercase tracking-[0.08em]"
                    type="button"
                    onClick={() => setEditing(false)}
                    disabled={saving}
                  >
                    Cancelar
                  </button>
                  <button
                    className="w-full rounded border border-zinc-300 py-2 text-xs font-semibold uppercase tracking-[0.08em]"
                    type="submit"
                    disabled={saving}
                  >
                    {saving ? "Salvando..." : "Salvar"}
                  </button>
                </div>
              </form>
            )}
            <div>
              <p className="text-zinc-500">E-mail</p>
              <p className="font-medium text-zinc-900">{user.email}</p>
            </div>
            <div>
              <p className="text-zinc-500">Perfil</p>
              <p className="font-medium text-zinc-900">{role === "admin" ? "Administrador" : "Cliente"}</p>
            </div>
            {message ? <p className="text-xs text-zinc-700">{message}</p> : null}
            <button onClick={onLogout} className="mt-3 w-full rounded bg-black py-3 text-sm font-semibold text-white">Sair da conta</button>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-zinc-600">Voce nao esta logado.</p>
            <Link className="inline-block rounded bg-black px-4 py-2 text-white" href="/login" onClick={onClose}>Entrar</Link>
          </div>
        )}
      </aside>
    </>
  );
}

function TopNav({ user, role, profile, supabase, onProfileUpdated }) {
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const cart = useCart();

  function isActive(href) {
    if (href === "/home") return pathname === "/" || pathname === "/home";
    if (href === "/catalog") return pathname?.startsWith("/catalog");
    if (href === "/carrinho") return pathname?.startsWith("/carrinho") || pathname?.startsWith("/checkout");
    if (href === "/admin/produtos") return pathname?.startsWith("/admin/produtos");
    return pathname === href;
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setDrawerOpen(false);
    router.push("/login");
  }

  return (
    <>
      <div className="mb-5 flex items-center justify-between border-b border-zinc-200 pb-4 text-xs uppercase tracking-[0.18em] text-zinc-600">
        <Link href="/home" className="font-serifDisplay text-xl normal-case tracking-normal text-zinc-900">Malu Store</Link>
        <div className="hidden gap-6 md:flex">
          <Link href="/home" className={isActive("/home") ? "font-semibold text-zinc-900" : ""}>Inicio</Link>
          <Link href="/catalog" className={isActive("/catalog") ? "font-semibold text-zinc-900" : ""}>Catalogo</Link>
          <Link href="/carrinho" className={`relative ${isActive("/carrinho") ? "font-semibold text-zinc-900" : ""}`}>
            Carrinho
            {cart.count > 0 ? (
              <span className="absolute -right-4 -top-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-black px-1 text-[10px] font-semibold text-white">
                {cart.count}
              </span>
            ) : null}
          </Link>
          {role === "admin" ? <Link href="/admin/produtos" className={isActive("/admin/produtos") ? "font-semibold text-zinc-900" : ""}>Admin</Link> : null}
        </div>
        <div className="flex items-center gap-3 text-[11px] normal-case tracking-normal">
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300 text-sm"
            aria-label="Abrir perfil"
            title="Perfil"
          >
            <span>U</span>
          </button>
          {!user ? <Link href="/login">Entrar</Link> : null}
        </div>
      </div>
      <ProfileDrawer
        user={user}
        profile={profile}
        role={role}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onLogout={handleLogout}
        supabase={supabase}
        onProfileUpdated={onProfileUpdated}
      />
    </>
  );
}

function Frame({ children }) {
  return (
    <main className="min-h-screen bg-[#f5f5f3] px-4 py-6 lg:px-10">
      <div className="mx-auto max-w-[1380px]">{children}</div>
    </main>
  );
}

function ProductCard({ item }) {
  const mainImage = Array.isArray(item.image_urls) && item.image_urls.length > 0
    ? item.image_urls[0]
    : item.image_url;

  return (
    <article className="rounded-xl bg-white p-3">
      {mainImage ? (
        <img src={mainImage} alt={item.name || "Produto"} className="h-44 w-full rounded-lg object-cover" />
      ) : (
        <div className="flex h-44 items-center justify-center rounded-lg bg-zinc-100 text-sm text-zinc-500">Sem imagem</div>
      )}
      <p className="mt-2 text-sm font-medium">{item.name}</p>
      <p className="text-xs text-zinc-600">{dinheiro(item.price)}</p>
      {Array.isArray(item.sizes) && item.sizes.length > 0 ? <p className="mt-1 text-xs text-zinc-500">Tamanhos: {item.sizes.join(", ")}</p> : null}
    </article>
  );
}

function useProducts(limit) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const supabase = useMemo(() => getSupabaseClient(), []);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");

      let query = supabase
        .from("products")
        .select("id,name,description,price,image_url,image_urls,sizes,stock,size_stock,categories(name)")
        .order("created_at", { ascending: false });

      if (limit) query = query.limit(limit);

      const { data, error: queryError } = await query;
      if (!active) return;

      if (queryError) {
        setError(queryError.message);
        setProducts([]);
      } else {
        setProducts(data || []);
      }
      setLoading(false);
    }

    load();

    return () => {
      active = false;
    };
  }, [supabase, limit]);

  return { products, loading, error };
}

export function HomeScreenPage() {
  const auth = useAuthContext();
  const { products, loading, error } = useProducts(6);

  return (
    <Frame>
      <section className="rounded-2xl border border-zinc-200 bg-[#f7f5f1] p-5 shadow-soft">
        <TopNav user={auth.user} role={auth.role} profile={auth.profile} supabase={auth.supabase} onProfileUpdated={auth.refreshProfile} />

        <div className="mt-5 grid gap-5 lg:grid-cols-[2fr_1fr]">
          <article className="relative overflow-hidden rounded-xl bg-[#e9e5df]">
            <img src="https://images.unsplash.com/photo-1485968579580-b6d095142e6e?w=1600&q=80" alt="Colecao de outono" className="h-[320px] w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/45 to-transparent" />
            <div className="absolute left-7 top-8 max-w-sm text-white">
              <h1 className="font-serifDisplay text-5xl leading-tight">Elegancia sem esforco.</h1>
              <p className="mt-2 text-sm">Produtos reais cadastrados no Supabase.</p>
              <Link href="/catalog" className="mt-5 inline-block rounded-full bg-black px-5 py-2 text-xs uppercase tracking-wider">Ver Catalogo</Link>
            </div>
          </article>
          <aside className="grid gap-3">
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl bg-[#ecdccd] p-4 text-sm"
            >
              <p>Vestidos</p>
              <p className="mt-1 text-[11px] text-zinc-600">Pagina do Instagram</p>
            </a>
            <div className="rounded-xl bg-[#efe8df] p-4 text-sm">Acessorios</div>
            <div className="rounded-xl bg-[#dde9ef] p-4 text-sm">Colecao Outono</div>
          </aside>
        </div>

        <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-[0.1em] text-zinc-500">Destaques da Semana</h2>
        {loading ? <p className="text-sm text-zinc-500">Carregando produtos...</p> : null}
        {error ? <p className="text-sm text-red-600">Erro ao carregar produtos: {error}</p> : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {products.map((item) => <ProductCard key={item.id} item={item} />)}
        </div>
      </section>
    </Frame>
  );
}

export function CatalogScreenPage() {
  const auth = useAuthContext();
  const { products, loading, error } = useProducts();
  const [activeCategoryTab, setActiveCategoryTab] = useState("todas");
  const [sizeFilters, setSizeFilters] = useState([]);
  const [priceRangeFilter, setPriceRangeFilter] = useState("all");
  const [maxPrice, setMaxPrice] = useState(500);

  const availableCategories = useMemo(() => {
    const names = Array.from(new Set(products.map((item) => item.categories?.name).filter(Boolean)));
    return names.sort((a, b) => a.localeCompare(b));
  }, [products]);

  const availableSizes = useMemo(() => {
    const allSizes = products.flatMap((item) => (Array.isArray(item.sizes) ? item.sizes : []));
    return Array.from(new Set(allSizes));
  }, [products]);

  const maxCatalogPrice = useMemo(() => {
    const prices = products.map((item) => Number(item.price || 0));
    const foundMax = prices.length ? Math.max(...prices) : 500;
    return Math.max(500, Math.ceil(foundMax / 50) * 50);
  }, [products]);

  useEffect(() => {
    setMaxPrice(maxCatalogPrice);
  }, [maxCatalogPrice]);

  function toggleInList(value, setter) {
    setter((prev) => (prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]));
  }

  function priceMatch(priceValue, selectedRange) {
    const price = Number(priceValue || 0);
    if (selectedRange === "ate_200") return price <= 200;
    if (selectedRange === "200_500") return price > 200 && price <= 500;
    if (selectedRange === "acima_500") return price > 500;
    return true;
  }

  const filteredProducts = useMemo(() => {
    return products.filter((item) => {
      const categoryName = item.categories?.name || "";
      const categoryMatch = activeCategoryTab === "todas" || categoryName === activeCategoryTab;
      const sizes = Array.isArray(item.sizes) ? item.sizes : [];
      const sizeMatch = sizeFilters.length === 0 || sizeFilters.some((size) => sizes.includes(size));
      const rangeOk = priceMatch(item.price, priceRangeFilter);
      const sliderOk = Number(item.price || 0) <= maxPrice;
      const stockMatch = getTotalProductStock(item) > 0;
      return categoryMatch && sizeMatch && rangeOk && sliderOk && stockMatch;
    });
  }, [products, activeCategoryTab, sizeFilters, priceRangeFilter, maxPrice]);

  return (
    <Frame>
      <section className="rounded-2xl border border-zinc-200 bg-[#f7f5f1] p-5 shadow-soft">
        <TopNav user={auth.user} role={auth.role} profile={auth.profile} supabase={auth.supabase} onProfileUpdated={auth.refreshProfile} />
        <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setActiveCategoryTab("todas")}
            className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.08em] ${activeCategoryTab === "todas" ? "border-black bg-black text-white" : "border-zinc-300 bg-white text-zinc-700"}`}
          >
            Todas
          </button>
          {availableCategories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setActiveCategoryTab(category)}
              className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.08em] ${activeCategoryTab === category ? "border-black bg-black text-white" : "border-zinc-300 bg-white text-zinc-700"}`}
            >
              {category}
            </button>
          ))}
        </div>

        {loading ? <p className="text-sm text-zinc-500">Carregando produtos...</p> : null}
        {error ? <p className="text-sm text-red-600">Erro ao carregar produtos: {error}</p> : null}
        {!loading && !error && products.length === 0 ? <p className="text-sm text-zinc-500">Nenhum produto cadastrado ainda.</p> : null}

        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <aside className="h-fit rounded-xl border border-zinc-200 bg-white p-4">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-zinc-600">Filtros</p>
            <div className="space-y-3 text-sm">
              <div className="border-b border-zinc-100 pb-3">
                <p className="mb-2 text-xs uppercase tracking-[0.08em] text-zinc-500">Tamanho</p>
                <div className="space-y-1">
                  {availableSizes.map((size) => (
                    <label key={size} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={sizeFilters.includes(size)}
                        onChange={() => toggleInList(size, setSizeFilters)}
                      />
                      {size}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.08em] text-zinc-500">Preco</p>
                <input
                  type="range"
                  min="0"
                  max={maxCatalogPrice}
                  step="10"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(Number(e.target.value))}
                  className="w-full"
                />
                <p className="mt-1 text-[11px] text-zinc-500">Ate {dinheiro(maxPrice)}</p>
                <div className="mt-2 space-y-1 text-xs">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="price-range" checked={priceRangeFilter === "all"} onChange={() => setPriceRangeFilter("all")} />
                    Todos
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="price-range" checked={priceRangeFilter === "ate_200"} onChange={() => setPriceRangeFilter("ate_200")} />
                    Ate R$ 200
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="price-range" checked={priceRangeFilter === "200_500"} onChange={() => setPriceRangeFilter("200_500")} />
                    R$ 200 a R$ 500
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="price-range" checked={priceRangeFilter === "acima_500"} onChange={() => setPriceRangeFilter("acima_500")} />
                    Acima de R$ 500
                  </label>
                </div>
              </div>
            </div>
          </aside>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredProducts.map((item) => {
              const images = Array.isArray(item.image_urls) && item.image_urls.length > 0
                ? item.image_urls
                : (item.image_url ? [item.image_url] : []);
              const mainImage = images[0] || null;

              return (
                <Link key={item.id} href={`/catalog/${item.id}`} className="rounded-xl border border-zinc-200 bg-white p-3">
                  {mainImage ? (
                    <div className="flex h-64 items-center justify-center rounded-lg bg-zinc-50">
                      <img src={mainImage} alt={item.name || "Produto"} className="max-h-full w-full rounded-lg object-contain" />
                    </div>
                  ) : (
                    <div className="flex h-64 items-center justify-center rounded-lg bg-zinc-100 text-sm text-zinc-500">Sem imagem</div>
                  )}
                  <p className="mt-2 text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-zinc-600">{dinheiro(item.price)}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </Frame>
  );
}

function useProductById(productId) {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const supabase = useMemo(() => getSupabaseClient(), []);

  useEffect(() => {
    if (!productId) return;
    let active = true;

    async function load() {
      setLoading(true);
      setError("");

      const { data, error: queryError } = await supabase
        .from("products")
        .select("id,name,description,price,image_url,image_urls,sizes,stock,size_stock,categories(name)")
        .eq("id", productId)
        .single();

      if (!active) return;

      if (queryError) {
        setError(queryError.message);
        setProduct(null);
      } else {
        setProduct(data || null);
      }

      setLoading(false);
    }

    load();

    return () => {
      active = false;
    };
  }, [productId, supabase]);

  return { product, loading, error };
}

export function ProductDetailsByIdPage({ productId }) {
  const auth = useAuthContext();
  const cart = useCart();
  const { product, loading, error } = useProductById(productId);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [selectedSize, setSelectedSize] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [cartMessage, setCartMessage] = useState("");
  const images = Array.isArray(product?.image_urls) && product.image_urls.length > 0
    ? product.image_urls
    : (product?.image_url ? [product.image_url] : []);
  const productSizes = Array.isArray(product?.sizes) ? product.sizes : [];
  const selectedStock = selectedSize
    ? getSizeStock(product, selectedSize)
    : getTotalProductStock(product);

  useEffect(() => {
    setActiveImageIndex(0);
    setQuantity(1);
    setCartMessage("");

    if (!product) {
      setSelectedSize("");
      return;
    }

    const sizes = Array.isArray(product.sizes) ? product.sizes : [];
    if (!sizes.length) {
      setSelectedSize("");
      return;
    }

    const firstAvailableSize = sizes.find((size) => getSizeStock(product, size) > 0);
    setSelectedSize(firstAvailableSize || sizes[0]);
  }, [product?.id]);

  function handleQuantityChange(rawValue) {
    const parsed = Math.floor(Number(rawValue));
    if (!Number.isFinite(parsed) || parsed < 1) {
      setQuantity(1);
      return;
    }
    const maxValue = selectedStock > 0 ? selectedStock : parsed;
    setQuantity(Math.min(parsed, maxValue));
  }

  function incrementQuantity() {
    const maxValue = selectedStock > 0 ? selectedStock : quantity + 1;
    setQuantity((prev) => Math.min(maxValue, prev + 1));
  }

  function decrementQuantity() {
    setQuantity((prev) => Math.max(1, prev - 1));
  }

  function handleAddToCart() {
    setCartMessage("");
    if (!product) return;

    if (productSizes.length > 0 && !selectedSize) {
      setCartMessage("Selecione um tamanho para adicionar ao carrinho.");
      return;
    }

    if (selectedStock <= 0) {
      setCartMessage("Produto sem estoque no momento.");
      return;
    }

    const selectedQuantity = Math.max(1, Math.floor(Number(quantity || 1)));
    const itemKey = `${product.id}::${selectedSize || "unico"}`;
    const currentItems = Array.isArray(cart.items) ? cart.items : [];
    const existingIndex = currentItems.findIndex((item) => getCartItemKey(item) === itemKey);
    const currentQuantity = existingIndex >= 0 ? Number(currentItems[existingIndex].quantity || 0) : 0;

    if (currentQuantity >= selectedStock) {
      setCartMessage("Voce ja adicionou o limite disponivel desse produto.");
      return;
    }

    const mergedQuantity = Math.min(currentQuantity + selectedQuantity, selectedStock);
    const nextItems = [...currentItems];
    const cartPayload = {
      id: itemKey,
      productId: product.id,
      name: product.name,
      price: Number(product.price || 0),
      imageUrl: images[0] || null,
      size: selectedSize || null,
      quantity: mergedQuantity,
      availableStock: selectedStock
    };

    if (existingIndex >= 0) {
      nextItems[existingIndex] = { ...nextItems[existingIndex], ...cartPayload };
    } else {
      nextItems.push(cartPayload);
    }

    cart.updateItems(nextItems);
    setCartMessage(mergedQuantity < currentQuantity + selectedQuantity
      ? "Produto adicionado ate o limite de estoque."
      : "Produto adicionado ao carrinho.");
  }

  return (
    <Frame>
      <section className="rounded-2xl border border-zinc-200 bg-[#f7f5f1] p-5 shadow-soft">
        <TopNav user={auth.user} role={auth.role} profile={auth.profile} supabase={auth.supabase} onProfileUpdated={auth.refreshProfile} />

        {loading ? <p className="text-sm text-zinc-500">Carregando produto...</p> : null}
        {error ? <p className="text-sm text-red-600">Erro ao carregar produto: {error}</p> : null}
        {!loading && !error && !product ? <p className="text-sm text-zinc-500">Produto nao encontrado.</p> : null}

        {product ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
            <div>
              {images[activeImageIndex] ? (
                <div className="flex h-[540px] items-center justify-center rounded-lg bg-zinc-50">
                  <img src={images[activeImageIndex]} alt={product.name} className="max-h-full w-full rounded-lg object-contain" />
                </div>
              ) : (
                <div className="flex h-[540px] items-center justify-center rounded-lg bg-zinc-100 text-sm text-zinc-500">Sem imagem</div>
              )}

              {images.length > 1 ? (
                <div className="mt-3 grid grid-cols-5 gap-2">
                  {images.map((imageUrl, idx) => (
                    <button
                      key={`${product.id}-detail-img-${idx}`}
                      type="button"
                      onClick={() => setActiveImageIndex(idx)}
                      className={`overflow-hidden rounded border ${activeImageIndex === idx ? "border-black" : "border-zinc-200"}`}
                    >
                      <img src={imageUrl} alt={`${product.name} ${idx + 1}`} className="h-16 w-full object-cover" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="pt-4">
              <p className="mb-2 text-xs uppercase tracking-[0.2em] text-zinc-500">{product.categories?.name || "Produto"}</p>
              <h1 className="font-serifDisplay text-5xl leading-none">{product.name}</h1>
              <p className="mt-2 text-4xl">{dinheiro(product.price)}</p>
              <p className="mt-6 text-sm text-zinc-700">{product.description || "Sem descricao."}</p>

              {productSizes.length > 0 ? (
                <div className="mt-6">
                  <p className="mb-2 text-xs uppercase tracking-[0.08em] text-zinc-500">Tamanhos disponiveis</p>
                  <div className="flex flex-wrap gap-2">
                    {productSizes.map((size) => {
                      const sizeStock = getSizeStock(product, size);
                      const isSelected = selectedSize === size;
                      const outOfStock = sizeStock <= 0;
                      return (
                        <button
                          key={size}
                          type="button"
                          disabled={outOfStock}
                          onClick={() => setSelectedSize(size)}
                          className={`rounded-full border px-3 py-1 text-xs ${isSelected ? "border-black bg-black text-white" : "border-zinc-300 bg-white text-zinc-700"} ${outOfStock ? "cursor-not-allowed opacity-40" : ""}`}
                        >
                          {size}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    Estoque no tamanho selecionado: {selectedSize ? getSizeStock(product, selectedSize) : 0}
                  </p>
                </div>
              ) : null}

              <div className="mt-6">
                <p className="mb-2 text-xs uppercase tracking-[0.08em] text-zinc-500">Quantidade</p>
                <div className="flex w-fit items-center overflow-hidden rounded border border-zinc-300">
                  <button type="button" className="px-3 py-2 text-sm" onClick={decrementQuantity}>-</button>
                  <input
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(event) => handleQuantityChange(event.target.value)}
                    className="w-14 border-x border-zinc-300 py-2 text-center text-sm"
                  />
                  <button type="button" className="px-3 py-2 text-sm" onClick={incrementQuantity}>+</button>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleAddToCart}
                  disabled={selectedStock <= 0 || (productSizes.length > 0 && !selectedSize)}
                  className="rounded bg-black px-5 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {selectedStock <= 0 ? "Sem estoque" : "Adicionar ao carrinho"}
                </button>
                <Link href="/carrinho" className="text-xs uppercase tracking-[0.08em] text-zinc-700 underline">
                  Ver carrinho
                </Link>
              </div>
              {cartMessage ? <p className="mt-3 text-sm text-zinc-700">{cartMessage}</p> : null}
              {productSizes.length === 0 ? (
                <p className="mt-2 text-xs text-zinc-500">Estoque disponivel: {getTotalProductStock(product)}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </Frame>
  );
}

export function ProductScreenPage() {
  const auth = useAuthContext();
  const { products, loading, error } = useProducts(1);
  const product = products[0];
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const productImages = Array.isArray(product?.image_urls) && product.image_urls.length > 0
    ? product.image_urls
    : (product?.image_url ? [product.image_url] : []);
  const mainImage = productImages[activeImageIndex] || null;

  useEffect(() => {
    setActiveImageIndex(0);
  }, [product?.id]);

  function showNextImage() {
    if (productImages.length <= 1) return;
    setActiveImageIndex((prev) => (prev + 1) % productImages.length);
  }

  function showPrevImage() {
    if (productImages.length <= 1) return;
    setActiveImageIndex((prev) => (prev - 1 + productImages.length) % productImages.length);
  }

  return (
    <Frame>
      <section className="rounded-2xl border border-zinc-200 bg-[#f7f5f1] p-5 shadow-soft">
        <TopNav user={auth.user} role={auth.role} profile={auth.profile} supabase={auth.supabase} onProfileUpdated={auth.refreshProfile} />

        {loading ? <p className="text-sm text-zinc-500">Carregando produto...</p> : null}
        {error ? <p className="text-sm text-red-600">Erro ao carregar produto: {error}</p> : null}
        {!loading && !error && !product ? <p className="text-sm text-zinc-500">Cadastre um produto para visualizar essa pagina.</p> : null}

        {product ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
            <div>
              {mainImage ? (
                <div className="relative">
                  <img src={mainImage} alt={product.name} className="h-[500px] w-full rounded-lg object-cover" />
                  {productImages.length > 1 ? (
                    <>
                      <button
                        type="button"
                        onClick={showPrevImage}
                        className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 px-3 py-2 text-sm font-semibold"
                        aria-label="Foto anterior"
                      >
                        {"<"}
                      </button>
                      <button
                        type="button"
                        onClick={showNextImage}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 px-3 py-2 text-sm font-semibold"
                        aria-label="Proxima foto"
                      >
                        {">"}
                      </button>
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="flex h-[500px] items-center justify-center rounded-lg bg-zinc-100 text-sm text-zinc-500">Sem imagem</div>
              )}

              {productImages.length > 1 ? (
                <div className="mt-3 grid grid-cols-5 gap-2">
                  {productImages.map((imageUrl, index) => (
                    <button
                      key={`${product.id}-img-${index}`}
                      type="button"
                      onClick={() => setActiveImageIndex(index)}
                      className={`overflow-hidden rounded border ${activeImageIndex === index ? "border-black" : "border-zinc-200"}`}
                      aria-label={`Abrir foto ${index + 1}`}
                    >
                      <img src={imageUrl} alt={`${product.name} ${index + 1}`} className="h-16 w-full object-cover" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="pt-4">
              <h2 className="font-serifDisplay text-5xl leading-none">{product.name}</h2>
              <p className="mt-2 text-4xl">{dinheiro(product.price)}</p>
              <p className="mt-6 text-sm text-zinc-500">Descricao</p>
              <p className="mt-2 text-zinc-700">{product.description || "Sem descricao."}</p>

              {Array.isArray(product.sizes) && product.sizes.length ? (
                <div className="mt-6">
                  <p className="mb-2 text-sm text-zinc-500">Tamanhos disponiveis</p>
                  <div className="flex flex-wrap gap-2">
                    {product.sizes.map((size) => <span key={size} className="rounded-full border border-zinc-300 px-3 py-1 text-xs">{size}</span>)}
                  </div>
                </div>
              ) : null}

            </div>
          </div>
        ) : null}
      </section>
    </Frame>
  );
}

export function CheckoutScreenPage() {
  const auth = useAuthContext();
  const cart = useCart();
  const cartItems = Array.isArray(cart.items) ? cart.items : [];

  const subtotal = useMemo(() => {
    return cartItems.reduce((sum, item) => {
      const quantity = Math.max(0, Number(item.quantity || 0));
      const price = Number(item.price || 0);
      return sum + (price * quantity);
    }, 0);
  }, [cartItems]);

  function updateCartItemQuantity(item, nextQuantity) {
    const sanitized = Math.max(0, Math.floor(Number(nextQuantity || 0)));
    const maxAvailable = Math.max(0, Math.floor(Number(item.availableStock || 0)));
    const bounded = maxAvailable > 0 ? Math.min(sanitized, maxAvailable) : sanitized;

    const nextItems = cartItems
      .map((currentItem) => {
        if (getCartItemKey(currentItem) !== getCartItemKey(item)) return currentItem;
        return { ...currentItem, quantity: bounded };
      })
      .filter((currentItem) => Number(currentItem.quantity || 0) > 0);

    cart.updateItems(nextItems);
  }

  function removeCartItem(item) {
    const nextItems = cartItems.filter((currentItem) => getCartItemKey(currentItem) !== getCartItemKey(item));
    cart.updateItems(nextItems);
  }

  function clearCart() {
    cart.updateItems([]);
  }

  return (
    <Frame>
      <section className="rounded-2xl border border-zinc-200 bg-[#f7f5f1] p-5 shadow-soft">
        <TopNav user={auth.user} role={auth.role} profile={auth.profile} supabase={auth.supabase} onProfileUpdated={auth.refreshProfile} />
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="font-serifDisplay text-4xl">Carrinho</p>
            <p className="text-sm text-zinc-500">
              {cart.count > 0 ? `${cart.count} item(ns) selecionado(s)` : "Seu carrinho esta vazio."}
            </p>
          </div>
          {cartItems.length > 0 ? (
            <button type="button" onClick={clearCart} className="text-xs uppercase tracking-[0.08em] text-zinc-700 underline">
              Limpar carrinho
            </button>
          ) : null}
        </div>

        {cartItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center">
            <p className="text-sm text-zinc-600">Nenhum produto foi adicionado ao carrinho ainda.</p>
            <Link href="/catalog" className="mt-4 inline-block rounded bg-black px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-white">
              Ir para catalogo
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-3">
              {cartItems.map((item) => {
                const quantity = Math.max(1, Number(item.quantity || 1));
                const lineTotal = Number(item.price || 0) * quantity;
                const imageUrl = item.imageUrl || item.image_url || null;
                return (
                  <article key={getCartItemKey(item)} className="flex gap-4 rounded-xl border border-zinc-200 bg-white p-3">
                    {imageUrl ? (
                      <img src={imageUrl} alt={item.name || "Produto"} className="h-24 w-20 rounded object-cover" />
                    ) : (
                      <div className="flex h-24 w-20 items-center justify-center rounded bg-zinc-100 text-[11px] text-zinc-500">Sem imagem</div>
                    )}

                    <div className="flex flex-1 flex-col justify-between">
                      <div>
                        <p className="text-sm font-medium text-zinc-900">{item.name || "Produto"}</p>
                        {item.size ? <p className="text-xs text-zinc-500">Tamanho: {item.size}</p> : null}
                        <p className="mt-1 text-xs text-zinc-700">{dinheiro(item.price)}</p>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="flex items-center overflow-hidden rounded border border-zinc-300">
                          <button type="button" className="px-3 py-2 text-xs" onClick={() => updateCartItemQuantity(item, quantity - 1)}>-</button>
                          <input
                            type="number"
                            min="1"
                            value={quantity}
                            onChange={(event) => updateCartItemQuantity(item, event.target.value)}
                            className="w-14 border-x border-zinc-300 py-2 text-center text-xs"
                          />
                          <button type="button" className="px-3 py-2 text-xs" onClick={() => updateCartItemQuantity(item, quantity + 1)}>+</button>
                        </div>

                        <div className="text-right">
                          <p className="text-sm font-semibold text-zinc-900">{dinheiro(lineTotal)}</p>
                          <button type="button" onClick={() => removeCartItem(item)} className="text-[11px] uppercase tracking-[0.08em] text-zinc-500 underline">
                            Remover
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <aside className="h-fit rounded-xl border border-zinc-200 bg-white p-4">
              <p className="text-xs uppercase tracking-[0.08em] text-zinc-500">Resumo</p>
              <div className="mt-3 flex items-center justify-between text-sm">
                <span>Subtotal</span>
                <strong>{dinheiro(subtotal)}</strong>
              </div>
              <p className="mt-2 text-xs text-zinc-500">Frete e descontos serao calculados no fechamento do pedido.</p>
              <button type="button" className="mt-4 w-full rounded bg-black py-3 text-xs font-semibold uppercase tracking-[0.08em] text-white">
                Finalizar pedido
              </button>
            </aside>
          </div>
        )}
      </section>
    </Frame>
  );
}

export function LoginPage() {
  const router = useRouter();
  const auth = useAuthContext();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (auth.user) router.push("/home");
  }, [auth.user, router]);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");

    const { data, error } = await auth.supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setMessage(error.message);
      return;
    }

    if (!data.session) {
      setMessage("Login realizado, mas a sessao nao foi iniciada. Verifique confirmacao de e-mail no Supabase Auth.");
      return;
    }

    router.push("/home");
  }

  return (
    <Frame>
      <section className="mx-auto max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <h1 className="font-serifDisplay text-4xl">Entrar</h1>
        <p className="mt-1 text-sm text-zinc-600">Acesse sua conta da Malu Store.</p>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <input className="w-full rounded border border-zinc-300 px-3 py-2" type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="w-full rounded border border-zinc-300 px-3 py-2" type="password" placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="w-full rounded bg-black py-3 text-sm font-semibold text-white" type="submit">Entrar</button>
        </form>
        {message ? <p className="mt-3 text-sm text-red-600">{message}</p> : null}
        <p className="mt-4 text-center text-sm text-zinc-600">
          Nao tem conta? <Link href="/signup" className="font-medium text-black underline">Criar cadastro</Link>
        </p>
      </section>
    </Frame>
  );
}

export function SignupPage() {
  const router = useRouter();
  const auth = useAuthContext();
  const [form, setForm] = useState({ fullName: "", email: "", password: "", passwordConfirm: "" });
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (auth.user) router.push("/home");
  }, [auth.user, router]);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");

    if (form.password !== form.passwordConfirm) {
      setMessage("As senhas nao conferem.");
      return;
    }

    const { data, error } = await auth.supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { full_name: form.fullName } }
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    if (data.user) {
      await auth.supabase.from("profiles").upsert({
        id: data.user.id,
        full_name: form.fullName,
        role: "customer"
      });
    }

    setMessage("Conta criada. Verifique seu e-mail para confirmar cadastro.");
    router.push("/login");
  }

  return (
    <Frame>
      <section className="mx-auto max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <h1 className="font-serifDisplay text-4xl">Criar Conta</h1>
        <p className="mt-1 text-sm text-zinc-600">Cadastre-se para comprar na Malu Store.</p>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <input className="w-full rounded border border-zinc-300 px-3 py-2" type="text" placeholder="Nome completo" value={form.fullName} onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))} required />
          <input className="w-full rounded border border-zinc-300 px-3 py-2" type="email" placeholder="E-mail" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} required />
          <input className="w-full rounded border border-zinc-300 px-3 py-2" type="password" placeholder="Senha" value={form.password} onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} required />
          <input className="w-full rounded border border-zinc-300 px-3 py-2" type="password" placeholder="Confirmar senha" value={form.passwordConfirm} onChange={(e) => setForm((prev) => ({ ...prev, passwordConfirm: e.target.value }))} required />
          <button className="w-full rounded bg-black py-3 text-sm font-semibold text-white" type="submit">Criar conta</button>
        </form>
        {message ? <p className="mt-3 text-sm text-zinc-700">{message}</p> : null}
        <p className="mt-4 text-center text-sm text-zinc-600">
          Ja tem conta? <Link href="/login" className="font-medium text-black underline">Entrar</Link>
        </p>
      </section>
    </Frame>
  );
}

export function AdminProductsPage() {
  const auth = useAuthContext();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [expandedProductId, setExpandedProductId] = useState(null);
  const [editingProductId, setEditingProductId] = useState(null);
  const [updatingProductId, setUpdatingProductId] = useState(null);
  const [updatingStockId, setUpdatingStockId] = useState(null);
  const [stockDrafts, setStockDrafts] = useState({});
  const [productEditDrafts, setProductEditDrafts] = useState({});
  const [productList, setProductList] = useState([]);
  const [categoryList, setCategoryList] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("todas");
  const [sizeFilter, setSizeFilter] = useState("todos");
  const [files, setFiles] = useState([]);
  const [sizeMode, setSizeMode] = useState("letras");
  const [selectedSizes, setSelectedSizes] = useState([]);
  const [sizeStockMap, setSizeStockMap] = useState({});
  const [form, setForm] = useState({
    name: "",
    description: "",
    price: "",
    categoryName: ""
  });

  useEffect(() => {
    if (!auth.user || auth.role !== "admin") return;

    let active = true;

    async function loadAdminData() {
      const [{ data: products, error: productsError }, { data: categories, error: categoriesError }] = await Promise.all([
        auth.supabase
          .from("products")
          .select("id,name,description,price,stock,image_url,image_urls,sizes,size_stock,categories(name)")
          .order("created_at", { ascending: false }),
        auth.supabase
          .from("categories")
          .select("id,name,slug")
          .order("name", { ascending: true })
      ]);

      if (!active) return;

      if (productsError) {
        setMessage(`Erro ao listar produtos: ${productsError.message}`);
      } else {
        setProductList(products || []);
      }

      if (categoriesError) {
        setMessage(`Erro ao listar categorias: ${categoriesError.message}`);
      } else {
        setCategoryList(categories || []);
      }
    }

    loadAdminData();

    return () => {
      active = false;
    };
  }, [auth.user, auth.role, auth.supabase]);

  function toggleSize(sizeValue) {
    setSelectedSizes((prev) => {
      const exists = prev.includes(sizeValue);
      const next = exists ? prev.filter((value) => value !== sizeValue) : [...prev, sizeValue];
      if (exists) {
        setSizeStockMap((old) => {
          const copy = { ...old };
          delete copy[sizeValue];
          return copy;
        });
      }
      return next;
    });
  }

  const filteredProducts = useMemo(() => {
    return productList.filter((product) => {
      const normalizedSearch = searchTerm.toLowerCase().trim();
      const nameMatch = !normalizedSearch || product.name?.toLowerCase().includes(normalizedSearch);
      const categoryName = product.categories?.name || "";
      const categoryMatch = categoryFilter === "todas" || categoryName === categoryFilter;
      const sizes = Array.isArray(product.sizes) ? product.sizes : [];
      const sizeMatch = sizeFilter === "todos" || sizes.includes(sizeFilter);
      return nameMatch && categoryMatch && sizeMatch;
    });
  }, [productList, searchTerm, categoryFilter, sizeFilter]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setMessage("");

    if (!auth.user) {
      setMessage("Voce precisa estar logado.");
      return;
    }

    if (auth.role !== "admin") {
      setMessage("Apenas administradores podem cadastrar produtos.");
      return;
    }

    try {
      setSubmitting(true);

      const normalizedCategoryName = form.categoryName.trim();
      if (!normalizedCategoryName) {
        setMessage("Informe uma categoria.");
        return;
      }
      if (selectedSizes.length === 0) {
        setMessage("Selecione pelo menos um tamanho.");
        return;
      }

      const sizeStock = {};
      for (const size of selectedSizes) {
        const rawValue = String(sizeStockMap[size] ?? "").trim();
        if (rawValue === "") {
          setMessage(`Informe o estoque para o tamanho ${size}.`);
          return;
        }
        const numericValue = Number(rawValue);
        if (!Number.isFinite(numericValue) || numericValue < 0) {
          setMessage(`Estoque invalido para o tamanho ${size}.`);
          return;
        }
        sizeStock[size] = Math.floor(numericValue);
      }
      const totalStock = Object.values(sizeStock).reduce((sum, value) => sum + value, 0);

      const localMatch = categoryList.find((category) => category.name.toLowerCase() === normalizedCategoryName.toLowerCase());
      let categoryId = localMatch?.id;

      if (!categoryId) {
        const generatedSlug = slugify(normalizedCategoryName);
        const { data: newCategory, error: categoryError } = await withTimeout(
          auth.supabase
            .from("categories")
            .insert({ name: normalizedCategoryName, slug: `${generatedSlug}-${Date.now()}` })
            .select("id,name,slug")
            .single(),
          "criacao de categoria"
        );

        if (categoryError) {
          setMessage(`Erro ao criar categoria: ${categoryError.message}`);
          return;
        }

        categoryId = newCategory.id;
        setCategoryList((prev) => [...prev, newCategory].sort((a, b) => a.name.localeCompare(b.name)));
      }

      const uploadedUrls = [];

      for (const file of files) {
        const extension = file.name.split(".").pop();
        const path = `${auth.user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
        const { error: uploadError } = await withTimeout(
          auth.supabase.storage.from("product-images").upload(path, file, {
            cacheControl: "3600",
            upsert: false
          }),
          "upload de imagem"
        );

        if (uploadError) {
          setMessage(`Erro no upload da imagem: ${uploadError.message}`);
          return;
        }

        const { data: publicData } = auth.supabase.storage.from("product-images").getPublicUrl(path);
        if (publicData?.publicUrl) uploadedUrls.push(publicData.publicUrl);
      }

      const slug = `${slugify(form.name)}-${Date.now()}`;
      const { error } = await withTimeout(
        auth.supabase.from("products").insert({
          seller_id: auth.user.id,
          category_id: categoryId,
          name: form.name,
          slug,
          description: form.description,
          price: Number(form.price || 0),
          stock: totalStock,
          image_url: uploadedUrls[0] || null,
          image_urls: uploadedUrls,
          sizes: selectedSizes,
          size_stock: sizeStock,
          is_active: true
        }),
        "cadastro do produto"
      );

      if (error) {
        setMessage(`Erro ao cadastrar produto: ${error.message}`);
        return;
      }

      const { data: refreshedProducts } = await withTimeout(
        auth.supabase
          .from("products")
          .select("id,name,description,price,stock,image_url,image_urls,sizes,size_stock,categories(name)")
          .order("created_at", { ascending: false }),
        "atualizacao da lista"
      );

      setProductList(refreshedProducts || []);
      setMessage("Produto cadastrado com sucesso.");
      setForm({ name: "", description: "", price: "", categoryName: "" });
      setFiles([]);
      setSelectedSizes([]);
      setSizeStockMap({});
      setSizeMode("letras");
      setShowForm(false);
    } catch (error) {
      setMessage(`Erro ao salvar produto: ${error.message || "falha desconhecida"}`);
    } finally {
      setSubmitting(false);
    }
  }

  function toggleProductDetails(product) {
    const nextId = expandedProductId === product.id ? null : product.id;
    setExpandedProductId(nextId);
    if (!nextId) {
      setEditingProductId(null);
    }
    if (nextId && !stockDrafts[product.id]) {
      const current = {};
      const sizes = Array.isArray(product.sizes) ? product.sizes : [];
      for (const size of sizes) {
        const value = Number(product.size_stock?.[size] ?? 0);
        current[size] = Number.isFinite(value) ? value : 0;
      }
      setStockDrafts((prev) => ({ ...prev, [product.id]: current }));
    }
    if (nextId && !productEditDrafts[product.id]) {
      const images = Array.isArray(product.image_urls) && product.image_urls.length > 0
        ? [...product.image_urls]
        : (product.image_url ? [product.image_url] : []);
      setProductEditDrafts((prev) => ({
        ...prev,
        [product.id]: {
          name: product.name || "",
          price: String(product.price ?? ""),
          imageUrls: images,
          newFiles: []
        }
      }));
    }
  }

  function startEditProduct(product) {
    if (!productEditDrafts[product.id]) {
      const images = Array.isArray(product.image_urls) && product.image_urls.length > 0
        ? [...product.image_urls]
        : (product.image_url ? [product.image_url] : []);
      setProductEditDrafts((prev) => ({
        ...prev,
        [product.id]: {
          name: product.name || "",
          price: String(product.price ?? ""),
          imageUrls: images,
          newFiles: []
        }
      }));
    }
    setEditingProductId(product.id);
  }

  function cancelEditProduct(product) {
    const images = Array.isArray(product.image_urls) && product.image_urls.length > 0
      ? [...product.image_urls]
      : (product.image_url ? [product.image_url] : []);
    setProductEditDrafts((prev) => ({
      ...prev,
      [product.id]: {
        name: product.name || "",
        price: String(product.price ?? ""),
        imageUrls: images,
        newFiles: []
      }
    }));
    setEditingProductId(null);
  }

  async function saveProductInfo(product) {
    const draft = productEditDrafts[product.id];
    if (!draft) return;
    if (!draft.name || !draft.name.trim()) {
      setMessage("Nome do produto nao pode ficar vazio.");
      return;
    }
    const parsedPrice = Number(String(draft.price ?? "").replace(",", "."));
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setMessage("Valor do produto invalido.");
      return;
    }

    try {
      setUpdatingProductId(product.id);
      setMessage("");

      const finalUrls = [...(draft.imageUrls || [])];
      for (const file of draft.newFiles || []) {
        const extension = file.name.split(".").pop();
        const path = `${auth.user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
        const { error: uploadError } = await withTimeout(
          auth.supabase.storage.from("product-images").upload(path, file, {
            cacheControl: "3600",
            upsert: false
          }),
          "upload de imagem na edicao"
        );
        if (uploadError) {
          setMessage(`Erro no upload da imagem: ${uploadError.message}`);
          return;
        }
        const { data: publicData } = auth.supabase.storage.from("product-images").getPublicUrl(path);
        if (publicData?.publicUrl) finalUrls.push(publicData.publicUrl);
      }

      const { error } = await withTimeout(
        auth.supabase
          .from("products")
          .update({
            name: draft.name.trim(),
            price: parsedPrice,
            image_urls: finalUrls,
            image_url: finalUrls[0] || null
          })
          .eq("id", product.id),
        "atualizacao do produto"
      );

      if (error) {
        setMessage(`Erro ao atualizar produto: ${error.message}`);
        return;
      }

      setProductList((prev) => prev.map((item) => (
        item.id === product.id
          ? { ...item, name: draft.name.trim(), price: parsedPrice, image_urls: finalUrls, image_url: finalUrls[0] || null }
          : item
      )));
      setProductEditDrafts((prev) => ({
        ...prev,
        [product.id]: {
          ...(prev[product.id] || {}),
          name: draft.name.trim(),
          price: String(parsedPrice),
          imageUrls: finalUrls,
          newFiles: []
        }
      }));
      setEditingProductId(null);
      setMessage(`Produto ${draft.name.trim()} atualizado com sucesso.`);
    } catch (error) {
      setMessage(`Erro ao atualizar produto: ${error.message || "falha desconhecida"}`);
    } finally {
      setUpdatingProductId(null);
    }
  }

  async function saveSizeStock(product) {
    const draft = stockDrafts[product.id] || {};
    const sizes = Array.isArray(product.sizes) ? product.sizes : [];
    const payload = {};

    for (const size of sizes) {
      const value = Number(draft[size] ?? 0);
      if (!Number.isFinite(value) || value < 0) {
        setMessage(`Estoque invalido para o tamanho ${size} do produto ${product.name}.`);
        return;
      }
      payload[size] = Math.floor(value);
    }

    const totalStock = Object.values(payload).reduce((sum, value) => sum + value, 0);

    try {
      setUpdatingStockId(product.id);
      setMessage("");

      const { error } = await withTimeout(
        auth.supabase
          .from("products")
          .update({ size_stock: payload, stock: totalStock })
          .eq("id", product.id),
        "atualizacao de estoque"
      );

      if (error) {
        setMessage(`Erro ao atualizar estoque: ${error.message}`);
        return;
      }

      setProductList((prev) => prev.map((item) => (
        item.id === product.id ? { ...item, size_stock: payload, stock: totalStock } : item
      )));
      setMessage(`Estoque atualizado para ${product.name}.`);
    } catch (error) {
      setMessage(`Erro ao atualizar estoque: ${error.message || "falha desconhecida"}`);
    } finally {
      setUpdatingStockId(null);
    }
  }

  return (
    <Frame>
      <section className="mx-auto max-w-6xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <TopNav user={auth.user} role={auth.role} profile={auth.profile} supabase={auth.supabase} onProfileUpdated={auth.refreshProfile} />
        <h1 className="font-serifDisplay text-4xl">Produtos Cadastrados</h1>

        {!auth.user ? <p className="mt-4 text-sm text-zinc-600">Faca login para cadastrar produtos.</p> : null}
        {auth.loading ? <p className="mt-4 text-sm text-zinc-600">Verificando permissao...</p> : null}
        {!auth.loading && auth.user && auth.role !== "admin" ? <p className="mt-4 text-sm text-red-600">Sua conta nao e administradora.</p> : null}

        {!auth.loading && auth.user && auth.role === "admin" ? (
          <div className="mt-6 space-y-6">
            <div className="grid gap-3 md:grid-cols-3">
              <input
                className="rounded border border-zinc-300 px-3 py-2 text-sm"
                placeholder="Buscar por nome"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <select
                className="rounded border border-zinc-300 px-3 py-2 text-sm"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="todas">Todas as categorias</option>
                {categoryList.map((category) => (
                  <option key={category.id} value={category.name}>{category.name}</option>
                ))}
              </select>
              <select
                className="rounded border border-zinc-300 px-3 py-2 text-sm"
                value={sizeFilter}
                onChange={(e) => setSizeFilter(e.target.value)}
              >
                <option value="todos">Todos os tamanhos</option>
                {[...SIZE_OPTIONS.letras, ...SIZE_OPTIONS.numeros].map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>

            {filteredProducts.length === 0 ? (
              <p className="text-sm text-zinc-500">Nenhum produto cadastrado ainda.</p>
            ) : (
              <div className="space-y-3">
                {filteredProducts.map((product) => {
                  const mainImage = Array.isArray(product.image_urls) && product.image_urls.length > 0
                    ? product.image_urls[0]
                    : product.image_url;
                  const isExpanded = expandedProductId === product.id;
                  const isEditing = editingProductId === product.id;
                  const sizes = Array.isArray(product.sizes) ? product.sizes : [];
                  const currentDraft = stockDrafts[product.id] || {};
                  const productDraft = productEditDrafts[product.id] || {
                    name: product.name || "",
                    price: String(product.price ?? ""),
                    imageUrls: Array.isArray(product.image_urls) && product.image_urls.length > 0
                      ? product.image_urls
                      : (product.image_url ? [product.image_url] : []),
                    newFiles: []
                  };

                  return (
                    <article key={product.id} className="rounded-lg border border-zinc-200 p-3">
                      <div className="grid grid-cols-[64px_1fr_auto] gap-3">
                        {mainImage ? (
                          <img src={mainImage} alt={product.name} className="h-16 w-16 rounded object-cover" />
                        ) : (
                          <div className="flex h-16 w-16 items-center justify-center rounded bg-zinc-100 text-[10px] text-zinc-500">Sem foto</div>
                        )}
                        <div>
                          <p className="text-sm font-semibold">{product.name}</p>
                          <p className="text-xs text-zinc-600">{dinheiro(product.price)} | {product.categories?.name || "Sem categoria"}</p>
                          <p className="text-xs text-zinc-500">Estoque total: {Number(product.stock || 0)}</p>
                          {sizes.length > 0 ? (
                            <p className="text-xs text-zinc-500">
                              Tamanhos: {sizes.join(", ")}
                            </p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleProductDetails(product)}
                          className="h-8 w-8 rounded border border-zinc-300 text-xs"
                          title={isExpanded ? "Ocultar detalhes" : "Exibir detalhes"}
                          aria-label={isExpanded ? "Ocultar detalhes" : "Exibir detalhes"}
                        >
                          {isExpanded ? "^" : "v"}
                        </button>
                      </div>

                      {isExpanded ? (
                        <div className="mt-4 rounded border border-zinc-200 bg-zinc-50 p-3">
                          <p className="text-xs text-zinc-500">Descricao</p>
                          <p className="mb-3 text-sm text-zinc-700">{product.description || "Sem descricao."}</p>

                          {!isEditing ? (
                            <button
                              type="button"
                              className="mb-3 rounded border border-zinc-300 px-3 py-2 text-xs"
                              onClick={() => startEditProduct(product)}
                            >
                              Editar nome e fotos
                            </button>
                          ) : (
                            <div className="mb-4 rounded border border-zinc-200 bg-white p-3">
                              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-zinc-600">Edicao do produto</p>
                              <div className="grid gap-3">
                                <input
                                  className="rounded border border-zinc-300 px-3 py-2 text-sm"
                                  value={productDraft.name}
                                  onChange={(e) => setProductEditDrafts((prev) => ({
                                    ...prev,
                                    [product.id]: {
                                      ...(prev[product.id] || productDraft),
                                      name: e.target.value
                                    }
                                  }))}
                                  placeholder="Nome do produto"
                                />
                                <input
                                  className="rounded border border-zinc-300 px-3 py-2 text-sm"
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={productDraft.price}
                                  onChange={(e) => setProductEditDrafts((prev) => ({
                                    ...prev,
                                    [product.id]: {
                                      ...(prev[product.id] || productDraft),
                                      price: e.target.value
                                    }
                                  }))}
                                  placeholder="Valor do produto"
                                />

                                <div>
                                  <p className="mb-2 text-xs text-zinc-500">Fotos atuais</p>
                                  {productDraft.imageUrls?.length > 0 ? (
                                    <div className="grid grid-cols-4 gap-2">
                                      {productDraft.imageUrls.map((imageUrl, imageIndex) => (
                                        <div key={`${product.id}-edit-img-${imageIndex}`} className="relative overflow-hidden rounded border border-zinc-200">
                                          <img src={imageUrl} alt={`${productDraft.name} ${imageIndex + 1}`} className="h-16 w-full object-cover" />
                                          <button
                                            type="button"
                                            className="absolute right-1 top-1 rounded bg-black/80 px-1 py-0.5 text-[10px] text-white"
                                            onClick={() => setProductEditDrafts((prev) => ({
                                              ...prev,
                                              [product.id]: {
                                                ...(prev[product.id] || productDraft),
                                                imageUrls: (prev[product.id]?.imageUrls || productDraft.imageUrls || []).filter((_, idx) => idx !== imageIndex)
                                              }
                                            }))}
                                          >
                                            x
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-xs text-zinc-500">Sem fotos.</p>
                                  )}
                                </div>

                                <input
                                  className="rounded border border-zinc-300 px-3 py-2 text-sm"
                                  type="file"
                                  accept="image/*"
                                  multiple
                                  onChange={(e) => {
                                    const newFiles = Array.from(e.target.files || []);
                                    setProductEditDrafts((prev) => ({
                                      ...prev,
                                      [product.id]: {
                                        ...(prev[product.id] || productDraft),
                                        newFiles
                                      }
                                    }));
                                  }}
                                />
                                {productDraft.newFiles?.length > 0 ? (
                                  <p className="text-xs text-zinc-500">{productDraft.newFiles.length} nova(s) foto(s) para adicionar.</p>
                                ) : null}

                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    className="rounded bg-black px-3 py-2 text-xs font-semibold text-white"
                                    onClick={() => saveProductInfo(product)}
                                    disabled={updatingProductId === product.id}
                                  >
                                    {updatingProductId === product.id ? "Salvando..." : "Salvar produto"}
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded border border-zinc-300 px-3 py-2 text-xs"
                                    onClick={() => cancelEditProduct(product)}
                                    disabled={updatingProductId === product.id}
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}

                          {sizes.length === 0 ? (
                            <p className="text-xs text-zinc-500">Esse produto nao possui tamanhos cadastrados.</p>
                          ) : (
                            <div className="space-y-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-zinc-600">Estoque por tamanho</p>
                              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                                {sizes.map((size) => (
                                  <label key={size} className="flex items-center gap-2 text-sm">
                                    <span className="min-w-10">{size}</span>
                                    <input
                                      type="number"
                                      min="0"
                                      className="w-full rounded border border-zinc-300 px-2 py-1"
                                      value={currentDraft[size] ?? 0}
                                      onChange={(e) => {
                                        const next = Number(e.target.value);
                                        setStockDrafts((prev) => ({
                                          ...prev,
                                          [product.id]: {
                                            ...(prev[product.id] || {}),
                                            [size]: Number.isFinite(next) ? next : 0
                                          }
                                        }));
                                      }}
                                    />
                                  </label>
                                ))}
                              </div>
                              <button
                                type="button"
                                className="rounded bg-black px-3 py-2 text-xs font-semibold text-white"
                                onClick={() => saveSizeStock(product)}
                                disabled={updatingStockId === product.id}
                              >
                                {updatingStockId === product.id ? "Salvando..." : "Salvar estoque"}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}

            <div className="border-t pt-5">
              {!showForm ? (
                <button
                  onClick={() => setShowForm(true)}
                  className="rounded bg-black px-4 py-3 text-sm font-semibold text-white"
                >
                  Cadastrar novo produto
                </button>
              ) : null}

              {showForm ? (
                <form className="mt-4 grid gap-4" onSubmit={handleSubmit}>
                  <input
                    className="rounded border border-zinc-300 px-3 py-2"
                    placeholder="Nome do produto"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    required
                  />
                  <input
                    className="rounded border border-zinc-300 px-3 py-2"
                    list="categorias-admin"
                    placeholder="Categoria (escolha uma existente ou digite nova)"
                    value={form.categoryName}
                    onChange={(e) => setForm((prev) => ({ ...prev, categoryName: e.target.value }))}
                    required
                  />
                  <datalist id="categorias-admin">
                    {categoryList.map((category) => (
                      <option key={category.id} value={category.name} />
                    ))}
                  </datalist>

                  <textarea
                    className="rounded border border-zinc-300 px-3 py-2"
                    placeholder="Descricao"
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    rows={4}
                  />

                  <input
                    className="rounded border border-zinc-300 px-3 py-2"
                    type="number"
                    step="0.01"
                    placeholder="Preco"
                    value={form.price}
                    onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
                    required
                  />

                  <div className="rounded border border-zinc-200 p-3">
                    <p className="mb-2 text-sm font-medium">Tipo de tamanho</p>
                    <select
                      className="w-full rounded border border-zinc-300 px-3 py-2"
                      value={sizeMode}
                      onChange={(e) => {
                        setSizeMode(e.target.value);
                        setSelectedSizes([]);
                        setSizeStockMap({});
                      }}
                    >
                      <option value="letras">Letra (PP, P, M, G, GG)</option>
                      <option value="numeros">Numero (34 ao 46)</option>
                    </select>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {SIZE_OPTIONS[sizeMode].map((size) => {
                        const checked = selectedSizes.includes(size);
                        return (
                          <button
                            key={size}
                            type="button"
                            onClick={() => toggleSize(size)}
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${checked ? "border-black bg-black text-white" : "border-zinc-300 bg-white text-zinc-700"}`}
                          >
                            <span className={`h-2.5 w-2.5 rounded-full border ${checked ? "border-white bg-white" : "border-zinc-400 bg-transparent"}`} />
                            {size}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {selectedSizes.length > 0 ? (
                    <div className="rounded border border-zinc-200 p-3">
                      <p className="mb-2 text-sm font-medium">Estoque por tamanho selecionado</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {selectedSizes.map((size) => (
                          <label key={size} className="flex items-center gap-2 text-sm">
                            <span className="min-w-10">{size}</span>
                            <input
                              className="w-full rounded border border-zinc-300 px-3 py-2"
                              type="number"
                              min="0"
                              placeholder="Qtd"
                              value={sizeStockMap[size] ?? ""}
                              onChange={(e) => setSizeStockMap((prev) => ({ ...prev, [size]: e.target.value }))}
                              required
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <input
                    className="rounded border border-zinc-300 px-3 py-2"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => setFiles(Array.from(e.target.files || []))}
                  />
                  {files.length > 0 ? <p className="text-xs text-zinc-600">{files.length} foto(s) selecionada(s)</p> : null}

                  <div className="flex gap-2">
                    <button className="rounded bg-black px-4 py-3 text-sm font-semibold text-white" type="submit" disabled={submitting}>
                      {submitting ? "Salvando..." : "Salvar produto"}
                    </button>
                    <button
                      className="rounded border border-zinc-300 px-4 py-3 text-sm"
                      type="button"
                      onClick={() => setShowForm(false)}
                      disabled={submitting}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          </div>
        ) : null}

        {message ? <p className="mt-4 text-sm text-zinc-700">{message}</p> : null}
      </section>
    </Frame>
  );
}

