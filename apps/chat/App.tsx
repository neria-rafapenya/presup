import { StatusBar } from "expo-status-bar";
import { createElement, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";

type Service = { slug: string; name: string; description?: string | null; image_url?: string | null; created_at: string; sector_pack_name?: string | null };
type ChatLine = { sender: "customer" | "assistant"; body: string };
type CatalogProduct = { sku: string; name: string; description?: string | null; unit?: string; base_price?: string | null; currency?: string; metadata?: Record<string, unknown> };
type ColorOption = { name: string; system?: string; code?: string; hex: string; rgb?: number[]; cmyk?: number[] };
type ColorConfig = { source?: string; systems?: string[]; allow_custom?: boolean; palette?: ColorOption[] };
type ActiveField = { key: string; label: string; type: string; unit?: string; options?: string[]; products_by_option?: Record<string, CatalogProduct[]>; color_config?: ColorConfig };
type AccountResponse = { session_token: string; email_sent: boolean };
type CustomerQuoteLine = { description: string; quantity: string; unit_price: string; amount: string };
type CustomerQuotePattern = { key: string; label: string; response: string; unit?: string | null; product_name?: string | null };
type CustomerQuote = { id: string; status: string; currency: string; subtotal: string; tax_amount: string; total: string; valid_until?: string | null; created_at: string; service_name?: string | null; service_slug?: string | null; patterns?: CustomerQuotePattern[]; lines?: CustomerQuoteLine[] };
type CustomerAccount = { customer: { id: string; name: string; email: string; phone?: string | null; account_created_at?: string | null }; quotes: CustomerQuote[] };

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";
const TENANT_SLUG = process.env.EXPO_PUBLIC_TENANT_SLUG ?? "empresa-demo-uno";
const RECAPTCHA_SITE_KEY = process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY ?? "";
const CUSTOMER_SESSION_STORAGE_KEY = "horekia.customer.session";
const latoRootStyle = { fontFamily: "Lato", fontSize: 15 } as any;
const DEMO_FAQ_URL = "https://www.horekia.com/#preguntas";

type RecaptchaEnterprise = {
  ready: (callback: () => void) => void;
  execute: (siteKey: string, options: { action: string }) => Promise<string>;
};

let recaptchaScriptPromise: Promise<void> | null = null;

function loadRecaptchaScript(): Promise<void> {
  if (Platform.OS !== "web" || !RECAPTCHA_SITE_KEY || typeof document === "undefined") return Promise.resolve();
  if (typeof window !== "undefined" && (window as typeof window & { grecaptcha?: { enterprise?: RecaptchaEnterprise } }).grecaptcha?.enterprise) return Promise.resolve();
  if (recaptchaScriptPromise) return recaptchaScriptPromise;
  recaptchaScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-horekia-recaptcha="enterprise"]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("No se ha podido cargar reCAPTCHA")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(RECAPTCHA_SITE_KEY)}`;
    script.async = true;
    script.dataset.horekiaRecaptcha = "enterprise";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("No se ha podido cargar reCAPTCHA"));
    document.head.appendChild(script);
  });
  return recaptchaScriptPromise;
}

async function getRecaptchaToken(action: string): Promise<string | null> {
  if (!RECAPTCHA_SITE_KEY) return null;
  await loadRecaptchaScript();
  const grecaptcha = typeof window !== "undefined" ? (window as typeof window & { grecaptcha?: { enterprise?: RecaptchaEnterprise } }).grecaptcha : undefined;
  if (!grecaptcha?.enterprise) throw new Error("reCAPTCHA todavía no está disponible. Inténtalo de nuevo.");
  return new Promise((resolve, reject) => {
    grecaptcha.enterprise?.ready(() => {
      void grecaptcha.enterprise?.execute(RECAPTCHA_SITE_KEY, { action }).then(resolve).catch(reject);
    });
  });
}

function openDemoFaq(): void {
  if (typeof window !== "undefined") window.open(DEMO_FAQ_URL, "_blank", "noopener,noreferrer");
}

function readCustomerSession(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(CUSTOMER_SESSION_STORAGE_KEY); } catch { return null; }
}

function storeCustomerSession(token: string): void {
  try { window.localStorage.setItem(CUSTOMER_SESSION_STORAGE_KEY, token); } catch { /* storage may be unavailable */ }
}

function clearCustomerSession(): void {
  try { window.localStorage.removeItem(CUSTOMER_SESSION_STORAGE_KEY); } catch { /* storage may be unavailable */ }
}

function decorateLegacyOpening(body: string): string {
  if (body.includes("**") || !body.startsWith("Hola")) return body;
  return body
    .replace(/^(Hola,\s+)([^.\n]+)(\.)/, "$1**$2**$3")
    .replace(/más adecuado/g, "**más adecuado**")
    .replace(/(Para saber si nuestro ámbito de actuación es viable,\s*¿dónde deberíamos prestar el servicio\?)/g, "**$1**");
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) }, ...options });
  if (!response.ok) {
    let detail = `API ${response.status}`;
    try { detail = (await response.json() as { detail?: string }).detail ?? detail; } catch { /* keep status */ }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function PublicMessageBody({ body }: { body: string }) {
  const formattedBody = decorateLegacyOpening(body);
  return <Text style={styles.messageText}>{formattedBody.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith("**") && part.endsWith("**") ? <Text key={`${part}-${index}`} style={styles.messageBold}>{part.slice(2, -2)}</Text> : part)}</Text>;
}

function customerQuoteStatus(status: string): string {
  return ({ needs_review: "Pendiente de revisión", approved: "Aprobado", sent: "Enviado", accepted: "Solicitud enviada", rejected: "Rechazado", expired: "Caducado" } as Record<string, string>)[status] ?? status;
}

function formatCustomerAmount(value: string, currency: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${value} ${currency}`;
  return `${amount.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function formatCustomerDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString("es-ES")} a las ${date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;
}

function productMetadata(product: CatalogProduct): Record<string, unknown> {
  const metadata = product.metadata ?? {};
  const catalog = metadata.catalog_product;
  return catalog && typeof catalog === "object" && !Array.isArray(catalog) ? catalog as Record<string, unknown> : metadata;
}

function productMetadataText(product: CatalogProduct, key: string): string | null {
  const value = productMetadata(product)[key];
  if (Array.isArray(value)) return value.map(String).join(" · ");
  return value === undefined || value === null || value === "" ? null : String(value);
}

const DEFAULT_COLOR_PALETTE: ColorOption[] = [
  { name: "Blanco", system: "RAL", code: "9003", hex: "#F4F4F4" },
  { name: "Blanco roto", system: "RAL", code: "1013", hex: "#E9E5D8" },
  { name: "Beige", system: "RAL", code: "1019", hex: "#A48F7A" },
  { name: "Gris claro", system: "RAL", code: "7035", hex: "#CBD0CC" },
  { name: "Gris antracita", system: "RAL", code: "7016", hex: "#383E42" },
  { name: "Negro", system: "RAL", code: "9005", hex: "#0A0A0D" },
  { name: "Rojo", system: "RAL", code: "3020", hex: "#C1121C" },
  { name: "Azul", system: "RAL", code: "5015", hex: "#2874B2" },
  { name: "Verde", system: "RAL", code: "6005", hex: "#0F4336" },
  { name: "Natural", system: "HEX", code: "#D8C3A5", hex: "#D8C3A5" },
  { name: "Amarillo", system: "Pantone", code: "116 C", hex: "#FFCD00" },
  { name: "Magenta", system: "Pantone", code: "214 C", hex: "#D50057" },
  { name: "Cian", system: "CMYK", code: "100,0,0,0", hex: "#00AEEF", cmyk: [100, 0, 0, 0] },
];

function colorDisplayText(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as ColorOption;
    if (parsed && typeof parsed === "object" && parsed.name) return [parsed.name, parsed.system && parsed.code ? `${parsed.system} ${parsed.code}` : parsed.code].filter(Boolean).join(" · ");
  } catch { /* regular text */ }
  return null;
}

function parseCustomColor(value: string): ColorOption {
  const normalized = value.trim();
  const hexMatch = normalized.match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (hexMatch) {
    const code = `#${hexMatch[1].toUpperCase()}`;
    return { name: code, system: "HEX", code, hex: code };
  }
  const rgbMatch = normalized.match(/^rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (rgbMatch) {
    const rgb = rgbMatch.slice(1).map(Number);
    return { name: normalized, system: "RGB", code: normalized, hex: `#${rgb.map((part) => part.toString(16).padStart(2, "0")).join("")}`, rgb };
  }
  const cmykMatch = normalized.match(/^cmyk\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i);
  if (cmykMatch) return { name: normalized, system: "CMYK", code: normalized, hex: "#CBD0CC", cmyk: cmykMatch.slice(1).map(Number) };
  const ralMatch = normalized.match(/^ral\s*(\d{4})$/i);
  if (ralMatch) return { name: normalized.toUpperCase(), system: "RAL", code: ralMatch[1], hex: "#CBD0CC" };
  return { name: normalized, system: "Personalizado", code: normalized, hex: "#CBD0CC" };
}

function ColorPickerComposer({ field, disabled, onSelect }: { field: ActiveField; disabled: boolean; onSelect: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [customValue, setCustomValue] = useState("");
  const configuredPalette = field.color_config?.palette;
  const palette = configuredPalette?.length ? configuredPalette : DEFAULT_COLOR_PALETTE;
  const allowedSystems = field.color_config?.systems;
  const visiblePalette = palette.filter((color) => (!allowedSystems?.length || !color.system || allowedSystems.includes(color.system) || (color.system === "RAL" && allowedSystems.includes("RAL"))) && `${color.name} ${color.system ?? ""} ${color.code ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const choose = (color: ColorOption) => { setOpen(false); setQuery(""); setCustomValue(""); onSelect(JSON.stringify(color)); };
  const chooseCustom = () => { if (customValue.trim()) choose(parseCustomColor(customValue)); };
  return <View style={styles.colorComposer}><Text style={styles.booleanHint}>Selecciona un color de la paleta disponible:</Text><Pressable style={styles.colorPickerButton} onPress={() => setOpen(true)} disabled={disabled}><View style={[styles.colorPickerDot, { backgroundColor: "#CBD0CC" }]} /><Text style={styles.colorPickerLabel}>Abrir tabla de colores</Text></Pressable><Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}><View style={styles.productModalBackdrop}><View style={styles.colorModalCard}><View style={styles.modalHeader}><View><Text style={styles.accountTitle}>Escoge un color</Text><Text style={styles.productModalSubtitle}>{field.color_config?.source === "product" ? "Colores disponibles para el producto" : "Paleta del servicio"}</Text></View><Pressable onPress={() => setOpen(false)}><Text style={styles.modalClose}>×</Text></Pressable></View><TextInput style={styles.colorSearch} value={query} onChangeText={setQuery} placeholder="Buscar por nombre o código…" autoFocus /><ScrollView style={styles.colorPaletteScroll} contentContainerStyle={styles.colorPalette}>{visiblePalette.map((color) => <Pressable key={`${color.system}-${color.code}-${color.name}`} style={styles.colorSwatchButton} onPress={() => choose(color)}><View style={[styles.colorSwatch, { backgroundColor: color.hex }]} /><Text style={styles.colorSwatchName}>{color.name}</Text><Text style={styles.colorSwatchCode}>{[color.system, color.code].filter(Boolean).join(" ")}</Text></Pressable>)}</ScrollView>{field.color_config?.allow_custom ? <View><Text style={styles.colorCustomHint}>Si no encuentras el tono, introduce un nombre, HEX, RGB, CMYK o RAL.</Text><View style={styles.colorCustomRow}><TextInput style={styles.colorCustomInput} value={customValue} onChangeText={setCustomValue} placeholder="Ejemplo: #D8C3A5 o RAL 7016" /><Pressable style={styles.colorCustomButton} onPress={chooseCustom} disabled={!customValue.trim()}><Text style={styles.sendLabel}>Usar color</Text></Pressable></View></View> : null}</View></View></Modal></View>;
}

function ProductChoiceComposer({ field, disabled, onSelect }: { field: ActiveField; disabled: boolean; onSelect: (option: string, productSku?: string) => void }) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [hoveredOption, setHoveredOption] = useState<string | null>(null);
  const productsByOption = field.products_by_option ?? {};
  const optionProducts = selectedOption ? (productsByOption[selectedOption] ?? []) : [];
  const close = () => setSelectedOption(null);
  return <View style={styles.choiceComposer}>
    <Text style={styles.booleanHint}>Selecciona una opción:</Text>
    <View style={styles.choiceOptions}>{(field.options ?? []).map((option) => {
      const products = productsByOption[option] ?? [];
      const preview = products[0];
      const previewBrand = preview ? productMetadataText(preview, "brand") : null;
      const previewModel = preview ? productMetadataText(preview, "model") : null;
      return <View key={option} style={[styles.productChoiceWrap, hoveredOption === option ? styles.productChoiceWrapActive : null]}><Pressable style={styles.choiceButton} onPress={() => products.length ? setSelectedOption(option) : onSelect(option)} disabled={disabled} onHoverIn={() => setHoveredOption(option)} onHoverOut={() => setHoveredOption(null)}>
        <Text style={styles.choiceButtonLabel}>{option}</Text>{products.length ? <Text style={styles.choiceButtonHint}>{products.length} modelos · ver</Text> : null}
      </Pressable>{Platform.OS === "web" && hoveredOption === option && products.length ? <View style={styles.productHoverPreview}><Text style={styles.productHoverTitle}>{products.length} modelos disponibles</Text><Text style={styles.productHoverText}>{[previewBrand, previewModel].filter(Boolean).join(" · ") || preview?.name}</Text><Text style={styles.productHoverHint}>Pulsa para elegir el modelo</Text></View> : null}</View>;
    })}</View>
    <Modal visible={Boolean(selectedOption)} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.productModalBackdrop}><View style={styles.productModalCard}>
        <View style={styles.modalHeader}><View><Text style={styles.accountTitle}>Elige un modelo</Text><Text style={styles.productModalSubtitle}>{selectedOption}</Text></View><Pressable onPress={close}><Text style={styles.modalClose}>×</Text></Pressable></View>
        <Text style={styles.productModalHint}>Selecciona el producto concreto para que podamos preparar el presupuesto con sus características.</Text>
        <ScrollView style={styles.productList}>{optionProducts.map((product) => {
          const metadata = productMetadata(product);
          const imageUrl = typeof metadata.image_url === "string" && metadata.image_url ? metadata.image_url : `${API_URL}/media/products/noimage.png`;
          const brand = productMetadataText(product, "brand");
          const model = productMetadataText(product, "model");
          const material = productMetadataText(product, "material") ?? productMetadataText(product, "materials");
          const grammage = productMetadataText(product, "grammage_g");
          const colors = productMetadataText(product, "colors");
          return <Pressable key={product.sku} style={styles.productCard} onPress={() => { close(); onSelect(selectedOption as string, product.sku); }} disabled={disabled}>
            {Platform.OS === "web" ? createElement("img", { src: imageUrl, alt: product.name, style: styles.productImage }) : <Image source={{ uri: imageUrl }} style={styles.productImage} accessibilityLabel={product.name} />}
            <View style={styles.productCardCopy}><Text style={styles.productName}>{product.name}</Text>{brand || model ? <Text style={styles.productMetaStrong}>{[brand, model].filter(Boolean).join(" · ")}</Text> : null}{material || grammage ? <Text style={styles.productMeta}>{[material, grammage ? `${grammage} g/m²` : null].filter(Boolean).join(" · ")}</Text> : null}{colors ? <Text style={styles.productMeta}>Colores: {colors}</Text> : null}{product.description ? <Text style={styles.productDescription}>{product.description}</Text> : null}{product.base_price ? <Text style={styles.productPrice}>{formatCustomerAmount(product.base_price, product.currency ?? "EUR")} / unidad</Text> : null}</View>
          </Pressable>;
        })}</ScrollView>
      </View></View>
    </Modal>
  </View>;
}

function CustomerAccountPanel({ account, loading, requestingQuoteId, deletingQuoteId, message, onBack, onRequestExecution, onDeleteQuote }: { account: CustomerAccount | null; loading: boolean; requestingQuoteId: string | null; deletingQuoteId: string | null; message: string | null; onBack: () => void; onRequestExecution: (quoteId: string) => void; onDeleteQuote: (quoteId: string) => Promise<void> }) {
  const [quoteForExecution, setQuoteForExecution] = useState<CustomerQuote | null>(null);
  const [quoteForDeletion, setQuoteForDeletion] = useState<CustomerQuote | null>(null);
  return <View>
    <View style={styles.accountHeader}><View><Text style={styles.title}>Mi cuenta</Text><Text style={styles.subtitle}>Consulta tus presupuestos y decide cuáles quieres encargar.</Text></View><Pressable onPress={onBack}><Text style={styles.restart}>Volver a servicios</Text></Pressable></View>
    {loading ? <ActivityIndicator color="#258269" size="large" style={styles.loader} /> : account ? <>
      <View style={styles.profileBox}><Text style={styles.accountTitle}>{account.customer.name}</Text><Text style={styles.accountText}>{account.customer.email}</Text></View>
      <Text style={styles.accountSectionTitle}>Mis presupuestos</Text>
      {account.quotes.length === 0 ? <Text style={styles.empty}>Todavía no tienes presupuestos.</Text> : <View style={styles.quoteList}>{account.quotes.map((quote) => <View style={styles.quoteCard} key={quote.id}><View style={styles.quoteHeader}><View style={styles.serviceCopy}><Text style={styles.quoteLabel}>{quote.service_name || "Presupuesto"}</Text><Text style={styles.quoteStatus}>{customerQuoteStatus(quote.status)}</Text></View><Text style={styles.quoteValue}>{formatCustomerAmount(quote.total, quote.currency)}</Text></View><Text style={styles.quoteDate}>Creado el {formatCustomerDateTime(quote.created_at)}</Text>{quote.patterns?.length ? <View style={styles.quotePatterns}><Text style={styles.quotePatternsTitle}>Patrones respondidos</Text>{quote.patterns.map((pattern) => <View style={styles.quotePattern} key={pattern.key}><Text style={styles.quotePatternLabel}>{pattern.label}</Text><Text style={styles.quotePatternResponse}>{pattern.response}{pattern.unit ? ` ${pattern.unit}` : ""}{pattern.product_name ? ` · ${pattern.product_name}` : ""}</Text></View>)}</View> : null}{quote.lines?.length ? <View style={styles.quoteBreakdown}><Text style={styles.quotePatternsTitle}>Desglose económico</Text>{quote.lines.map((line, index) => <View style={styles.quoteBreakdownLine} key={`${line.description}-${index}`}><Text style={styles.quoteBreakdownDescription}>{line.description}</Text><Text style={styles.quoteBreakdownAmount}>{formatCustomerAmount(line.amount, quote.currency)}</Text></View>)}</View> : null}<View style={styles.quoteActions}>{quote.status === "accepted" ? <Text style={[styles.accountText, styles.quoteActionMessage]}>La empresa ha recibido tu solicitud para llevar a cabo este presupuesto.</Text> : ["needs_review", "approved", "sent"].includes(quote.status) ? <Pressable style={styles.sendFull} onPress={() => setQuoteForExecution(quote)} disabled={requestingQuoteId === quote.id}><Text style={styles.sendLabel}>Solicitar llevarlo a cabo</Text></Pressable> : null}<Pressable style={styles.deleteQuoteButton} onPress={() => setQuoteForDeletion(quote)} disabled={deletingQuoteId === quote.id}><Text style={styles.deleteQuoteLabel}>{deletingQuoteId === quote.id ? "Eliminando…" : "Eliminar"}</Text></Pressable></View></View>)}</View>}
      {message ? <Text style={styles.success}>{message}</Text> : null}
    </> : <Text style={styles.error}>No se ha podido cargar tu cuenta. Vuelve a iniciar sesión.</Text>}
    <QuoteExecutionModal quote={quoteForExecution} onClose={() => setQuoteForExecution(null)} onConfirm={() => { if (quoteForExecution) onRequestExecution(quoteForExecution.id); setQuoteForExecution(null); }} requesting={quoteForExecution ? requestingQuoteId === quoteForExecution.id : false} />
    <DeleteQuoteModal quote={quoteForDeletion} onClose={() => setQuoteForDeletion(null)} onConfirm={async () => { if (quoteForDeletion) await onDeleteQuote(quoteForDeletion.id); setQuoteForDeletion(null); }} deleting={quoteForDeletion ? deletingQuoteId === quoteForDeletion.id : false} />
  </View>;
}

function QuoteExecutionModal({ quote, onClose, onConfirm, requesting }: { quote: CustomerQuote | null; onClose: () => void; onConfirm: () => void; requesting: boolean }) {
  return <Modal visible={Boolean(quote)} transparent animationType="fade" onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.modalCard}><View style={styles.modalHeader}><View><Text style={styles.accountTitle}>Solicitar llevarlo a cabo</Text><Text style={styles.quoteModalSubtitle}>{quote?.service_name || "Presupuesto"}</Text></View><Pressable onPress={onClose} disabled={requesting}><Text style={styles.modalClose}>×</Text></Pressable></View><ScrollView style={styles.quoteSummaryScroll}>{quote?.lines?.length ? <View style={styles.quoteSummaryLines}>{quote.lines.map((line, index) => <View style={styles.quoteSummaryLine} key={`${line.description}-${index}`}><View style={styles.serviceCopy}><Text style={styles.quoteSummaryDescription}>{line.description}</Text><Text style={styles.quoteSummaryMeta}>{line.quantity} × {formatCustomerAmount(line.unit_price, quote.currency)}</Text></View><Text style={styles.quoteSummaryAmount}>{formatCustomerAmount(line.amount, quote.currency)}</Text></View>)}</View> : <Text style={styles.accountText}>No hay líneas detalladas disponibles para este presupuesto.</Text>}<View style={styles.quoteSummaryTotals}><View style={styles.quoteTotalRow}><Text style={styles.accountText}>Subtotal</Text><Text style={styles.accountText}>{formatCustomerAmount(quote?.subtotal ?? "0", quote?.currency ?? "EUR")}</Text></View><View style={styles.quoteTotalRow}><Text style={styles.accountText}>Impuestos</Text><Text style={styles.accountText}>{formatCustomerAmount(quote?.tax_amount ?? "0", quote?.currency ?? "EUR")}</Text></View><View style={styles.quoteTotalRow}><Text style={styles.quoteTotalLabel}>Total</Text><Text style={styles.quoteTotalValue}>{formatCustomerAmount(quote?.total ?? "0", quote?.currency ?? "EUR")}</Text></View></View></ScrollView><Text style={styles.quoteConfirmText}>¿Confirmas que quieres solicitar a la empresa que lleve a cabo este presupuesto?</Text><View style={styles.modalActions}><Pressable style={styles.modalSecondaryButton} onPress={onClose} disabled={requesting}><Text style={styles.modalSecondaryLabel}>Cancelar</Text></Pressable><Pressable style={styles.sendFull} onPress={onConfirm} disabled={requesting}><Text style={styles.sendLabel}>{requesting ? "Enviando…" : "Sí, solicitarlo"}</Text></Pressable></View></View></View></Modal>;
}

function DeleteQuoteModal({ quote, onClose, onConfirm, deleting }: { quote: CustomerQuote | null; onClose: () => void; onConfirm: () => void; deleting: boolean }) {
  return <Modal visible={Boolean(quote)} transparent animationType="fade" onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.modalCard}><View style={styles.modalHeader}><Text style={styles.accountTitle}>Eliminar presupuesto</Text><Pressable onPress={onClose} disabled={deleting}><Text style={styles.modalClose}>×</Text></Pressable></View><Text style={styles.quoteModalSubtitle}>{quote?.service_name || "Presupuesto"}</Text><Text style={styles.accountText}>Este presupuesto dejará de aparecer en tu cuenta. El historial operativo de la empresa se conservará.</Text><Text style={styles.deleteQuoteWarning}>Esta acción no se puede deshacer desde tu cuenta.</Text><View style={styles.modalActions}><Pressable style={styles.modalSecondaryButton} onPress={onClose} disabled={deleting}><Text style={styles.modalSecondaryLabel}>Cancelar</Text></Pressable><Pressable style={styles.deleteQuoteConfirm} onPress={onConfirm} disabled={deleting}><Text style={styles.sendLabel}>{deleting ? "Eliminando…" : "Sí, eliminar"}</Text></Pressable></View></View></View></Modal>;
}

function CustomerLoginModal({ visible, email, password, loading, error, onEmailChange, onPasswordChange, onSubmit, onClose }: { visible: boolean; email: string; password: string; loading: boolean; error: string | null; onEmailChange: (value: string) => void; onPasswordChange: (value: string) => void; onSubmit: () => void; onClose: () => void }) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.modalCard}><View style={styles.modalHeader}><Text style={styles.accountTitle}>Acceder a mi cuenta</Text><Pressable onPress={onClose}><Text style={styles.modalClose}>×</Text></Pressable></View><Text style={styles.subtitle}>Consulta tus presupuestos o inicia una nueva solicitud como cliente identificado.</Text><TextInput style={styles.inputFull} value={email} onChangeText={onEmailChange} placeholder="Tu email" keyboardType="email-address" autoCapitalize="none" editable={!loading} autoFocus /><TextInput style={styles.inputFull} value={password} onChangeText={onPasswordChange} placeholder="Tu contraseña" secureTextEntry editable={!loading} onSubmitEditing={onSubmit} /><Pressable style={styles.sendFull} onPress={onSubmit} disabled={loading}><Text style={styles.sendLabel}>{loading ? "Accediendo…" : "Acceder"}</Text></Pressable>{error ? <Text style={styles.error}>{error}</Text> : null}</View></View></Modal>;
}

export default function App() {
  const { width: viewportWidth } = useWindowDimensions();
  const serviceCardWidth = viewportWidth >= 900 ? "31.8%" : viewportWidth >= 560 ? "48.5%" : "100%";
  const [services, setServices] = useState<Service[]>([]);
  const [serviceQuery, setServiceQuery] = useState("");
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [quoteAvailable, setQuoteAvailable] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailFailed, setEmailFailed] = useState(false);
  const [activeField, setActiveField] = useState<ActiveField | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountPasswordConfirmation, setAccountPasswordConfirmation] = useState("");
  const [sessionToken, setSessionToken] = useState<string | null>(() => readCustomerSession());
  const [accountOpen, setAccountOpen] = useState(() => typeof window !== "undefined" && window.location.pathname.endsWith("/account"));
  const [customerAccount, setCustomerAccount] = useState<CustomerAccount | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [requestingQuoteId, setRequestingQuoteId] = useState<string | null>(null);
  const [deletingQuoteId, setDeletingQuoteId] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [completingAccount, setCompletingAccount] = useState(false);
  const [conversationClosed, setConversationClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesScrollRef = useRef<ScrollView | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const customerNameRef = useRef<TextInput | null>(null);

  const restart = () => { setSelectedService(null); setRequestId(null); setMessages([]); setQuoteAvailable(false); setEmailSent(false); setEmailFailed(false); setActiveField(null); setConversationClosed(false); setCustomerName(""); setCustomerEmail(""); setAccountPassword(""); setAccountPasswordConfirmation(""); setError(null); setAccountOpen(false); setAccountMessage(null); if (Platform.OS === "web") window.history.pushState({}, "", "/"); };

  const navigateAccount = (open: boolean) => { setAccountOpen(open); setAccountMessage(null); if (Platform.OS === "web") window.history.pushState({}, "", open ? "/account" : "/"); };

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const link = document.createElement("link");
    const style = document.createElement("style");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Lato:wght@400;900&display=swap";
    link.setAttribute("data-horekia-font", "lato");
    style.setAttribute("data-horekia-font-style", "lato");
    style.textContent = `
      body, body * { font-family: "Lato", sans-serif !important; }
      body [style*="monospace"] { font-family: monospace !important; }
    `;
    document.head.appendChild(link);
    document.head.appendChild(style);
    return () => {
      link.remove();
      style.remove();
    };
  }, []);

  useEffect(() => { void loadRecaptchaScript().catch(() => undefined); }, []);

  useEffect(() => { void loadServices(); }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onPopState = () => setAccountOpen(window.location.pathname.endsWith("/account"));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (sessionToken) void loadAccount();
    else setCustomerAccount(null);
  }, [sessionToken]);

  useEffect(() => {
    const timer = setTimeout(() => messagesScrollRef.current?.scrollToEnd({ animated: true }), 40);
    return () => clearTimeout(timer);
  }, [messages, sending]);

  useEffect(() => {
    if (!selectedService || !requestId || sending || conversationClosed || quoteAvailable || emailSent) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [selectedService, requestId, sending, conversationClosed, quoteAvailable, emailSent, messages.length]);

  useEffect(() => {
    if (!emailSent) return;
    const timer = setTimeout(restart, 5000);
    return () => clearTimeout(timer);
  }, [emailSent]);

  useEffect(() => {
    if (!selectedService || requestId) return;
    const timer = setTimeout(() => customerNameRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [selectedService, requestId]);

  const loadServices = async () => {
    setLoading(true); setError(null);
    try { setServices(await api<Service[]>(`/api/v1/public/tenants/${encodeURIComponent(TENANT_SLUG)}/services`)); }
    catch { setError("No se han podido cargar los servicios. Comprueba que la API esté arrancada."); }
    finally { setLoading(false); }
  };

  const loadAccount = async () => {
    if (!sessionToken) return;
    setAccountLoading(true);
    try {
      setCustomerAccount(await api<CustomerAccount>(`/api/v1/public/tenants/${encodeURIComponent(TENANT_SLUG)}/account`, { headers: { "X-Customer-Session": sessionToken } }));
    } catch {
      setSessionToken(null); clearCustomerSession(); setCustomerAccount(null); setAccountOpen(false); setError("Tu sesión ha caducado. Vuelve a iniciar sesión.");
    } finally { setAccountLoading(false); }
  };

  const login = async () => {
    if (!loginEmail.trim() || !loginPassword) { setLoginError("Escribe tu email y contraseña."); return; }
    setLoginLoading(true); setLoginError(null);
    try {
      const result = await api<AccountResponse & { customer: { name: string; email: string } }>(`/api/v1/public/tenants/${encodeURIComponent(TENANT_SLUG)}/auth/login`, { method: "POST", body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }) });
      setSessionToken(result.session_token); storeCustomerSession(result.session_token); setLoginOpen(false); setLoginPassword(""); navigateAccount(true);
    } catch (loginRequestError) { setLoginError(loginRequestError instanceof Error ? loginRequestError.message : "No se ha podido iniciar sesión."); }
    finally { setLoginLoading(false); }
  };

  const logout = async () => {
    const token = sessionToken;
    try { if (token) await api(`/api/v1/public/tenants/${encodeURIComponent(TENANT_SLUG)}/auth/logout`, { method: "POST", headers: { "X-Customer-Session": token } }); } catch { /* local logout remains available */ }
    setSessionToken(null); clearCustomerSession(); setCustomerAccount(null); navigateAccount(false);
  };

  const requestExecution = async (quoteId: string) => {
    if (!sessionToken) return;
    setRequestingQuoteId(quoteId); setAccountMessage(null);
    try {
      const result = await api<{ status: string; message: string }>(`/api/v1/public/tenants/${encodeURIComponent(TENANT_SLUG)}/quotes/${encodeURIComponent(quoteId)}/request-execution`, { method: "POST", headers: { "X-Customer-Session": sessionToken } });
      setAccountMessage(result.message); await loadAccount();
    } catch (requestError) { setAccountMessage(requestError instanceof Error ? requestError.message : "No se ha podido enviar la solicitud."); }
    finally { setRequestingQuoteId(null); }
  };

  const deleteQuote = async (quoteId: string) => {
    if (!sessionToken) return;
    setDeletingQuoteId(quoteId); setAccountMessage(null);
    try {
      const result = await api<{ status: string; message: string }>(`/api/v1/public/tenants/${encodeURIComponent(TENANT_SLUG)}/quotes/${encodeURIComponent(quoteId)}`, { method: "DELETE", headers: { "X-Customer-Session": sessionToken } });
      setAccountMessage(result.message); await loadAccount();
    } catch (requestError) { setAccountMessage(requestError instanceof Error ? requestError.message : "No se ha podido eliminar el presupuesto."); }
    finally { setDeletingQuoteId(null); }
  };

  const chooseService = (service: Service) => {
    navigateAccount(false);
    setSelectedService(service); setConversationClosed(false); setRequestId(null); setMessages([]); setQuoteAvailable(false); setEmailSent(false); setEmailFailed(false); setActiveField(null); setDraft(""); setCustomerName(""); setCustomerEmail(""); setAccountPassword(""); setAccountPasswordConfirmation(""); setError(null);
    if (sessionToken) void startConversation(service, sessionToken);
  };

  const startConversation = async (serviceOverride?: Service, sessionOverride?: string | null) => {
    const service = serviceOverride ?? selectedService;
    const activeSession = sessionOverride ?? sessionToken;
    if (!service) return;
    if (!activeSession && (!customerName.trim() || customerName.trim().length < 2)) { setError("Escribe tu nombre para continuar."); return; }
    if (!activeSession && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customerEmail.trim())) { setError("Escribe un email válido para continuar."); return; }
    let recaptchaToken: string | null = null;
    try { recaptchaToken = await getRecaptchaToken("start_quote"); } catch (recaptchaError) { setError(recaptchaError instanceof Error ? recaptchaError.message : "No se ha podido validar la solicitud."); return; }
    setConversationClosed(false); setRequestId(null); setMessages([]); setQuoteAvailable(false); setEmailSent(false); setEmailFailed(false); setActiveField(null); setDraft(""); setSending(true); setError(null);
    try {
      const result = await api<{ request_id: string; message: { body: string }; field?: ActiveField | null }>(`/api/v1/public/tenants/${encodeURIComponent(TENANT_SLUG)}/conversations`, { method: "POST", body: JSON.stringify({ job_type_slug: service.slug, recaptcha_token: recaptchaToken, ...(activeSession ? { session_token: activeSession } : { customer_name: customerName.trim(), customer_email: customerEmail.trim() }) }) });
      setRequestId(result.request_id); setMessages([{ sender: "assistant", body: result.message.body }]); setActiveField(result.field ?? null);
    } catch (requestError) {
      if (activeSession) {
        setSessionToken(null); clearCustomerSession(); setError("Tu sesión ha caducado. Introduce tu nombre y email para continuar.");
      } else {
        setError(requestError instanceof Error ? requestError.message : "No se ha podido iniciar la conversación con este servicio.");
      }
    }
    finally { setSending(false); }
  };

  const sendMessage = async (preset?: string, productSku?: string) => {
    const content = (preset ?? draft).trim();
    if (!content || !requestId || sending || conversationClosed) return;
    const selectedProduct = productSku ? Object.values(activeField?.products_by_option ?? {}).flat().find((product) => product.sku === productSku) : undefined;
    const selectedProductLabel = selectedProduct ? [selectedProduct.name, productMetadataText(selectedProduct, "model")].filter(Boolean).join(" · ") : "";
    const selectedColorLabel = colorDisplayText(content);
    const visibleContent = selectedColorLabel ?? content;
    const visibleMessage = selectedProductLabel ? `${visibleContent}\nProducto elegido: ${selectedProductLabel}` : visibleContent;
    setDraft(""); setMessages((current) => [...current, { sender: "customer", body: visibleMessage }]); setSending(true); setError(null);
    try {
      const result = await api<{ reply: string; status?: string; field?: ActiveField | null; quote_available?: boolean; email_sent?: boolean }>(`/api/v1/public/conversations/${requestId}/messages`, { method: "POST", body: JSON.stringify({ content, ...(activeField?.key ? { field_key: activeField.key } : {}), ...(productSku ? { product_sku: productSku } : {}), ...(sessionToken ? { session_token: sessionToken } : {}) }) });
      setMessages((current) => [...current, { sender: "assistant", body: result.reply }]); setActiveField(result.field ?? null); setConversationClosed(result.status === "closed"); if (result.quote_available) setQuoteAvailable(true); if (result.email_sent) setEmailSent(true); if (result.status === "quoted" && sessionToken && !result.email_sent) setEmailFailed(true);
    } catch (requestError) {
      if (sessionToken) { setSessionToken(null); clearCustomerSession(); setError("Tu sesión ha caducado. Vuelve a identificarte para continuar."); }
      else setError("No se ha podido enviar el mensaje. Inténtalo de nuevo.");
    }
    finally { setSending(false); }
  };

  const completeAccount = async () => {
    if (!requestId) return;
    if (accountPassword.length < 8) { setError("La contraseña debe tener al menos 8 caracteres."); return; }
    if (accountPassword !== accountPasswordConfirmation) { setError("Las contraseñas no coinciden."); return; }
    let recaptchaToken: string | null = null;
    try { recaptchaToken = await getRecaptchaToken("complete_account"); } catch (recaptchaError) { setError(recaptchaError instanceof Error ? recaptchaError.message : "No se ha podido validar la cuenta."); return; }
    setCompletingAccount(true); setError(null);
    try {
      const result = await api<AccountResponse>(`/api/v1/public/conversations/${requestId}/account`, { method: "POST", body: JSON.stringify({ password: accountPassword, password_confirmation: accountPasswordConfirmation, recaptcha_token: recaptchaToken }) });
      setSessionToken(result.session_token); storeCustomerSession(result.session_token); setEmailSent(result.email_sent); setQuoteAvailable(false); setAccountPassword(""); setAccountPasswordConfirmation("");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No se ha podido activar la cuenta."); }
    finally { setCompletingAccount(false); }
  };

  const visibleServices = serviceQuery.trim()
    ? services.filter((service) => `${service.name} ${service.slug} ${service.description ?? ""}`.toLocaleLowerCase().includes(serviceQuery.trim().toLocaleLowerCase()))
    : services.slice(0, 10);

  return <View style={[styles.shell, Platform.OS === "web" ? latoRootStyle : null]}>
    <StatusBar style="dark" />
    <View pointerEvents="none" style={[styles.demoRibbon, { top: 32, left: -62, width: 245, paddingVertical: 18 }]}><Text style={styles.demoRibbonText}>DEMO ORIENTADA A{`\n`}PINTURA DECORATIVA</Text></View>
    <ScrollView contentContainerStyle={styles.page}>
    <View style={[styles.header, { alignItems: "center" }]}><View style={styles.headerBrand}>{Platform.OS === "web" ? createElement("img", { src: "/horekia-logo-app-new.svg?v=1", alt: "HorekIA", style: styles.brandImage }) : <Text style={styles.brand}>HOREKIA</Text>}</View><View style={styles.headerRight}><Text style={styles.headerHint}>Prepara tu presupuesto paso a paso</Text><Pressable accessibilityRole="button" accessibilityLabel="Acceso a mi cuenta" style={styles.accountLink} onPress={() => sessionToken ? navigateAccount(!accountOpen) : (setLoginError(null), setLoginOpen(true))}>{sessionToken ? <Text style={styles.accountLinkLabel}>{accountOpen ? "Volver" : "Mi cuenta"}</Text> : Platform.OS === "web" ? createElement("img", { src: "/login.svg?v=1", alt: "Acceder", title: "Acceder", style: { width: 24, height: 24, display: "block" } }) : <Text style={styles.accountLinkLabel}>↗</Text>}</Pressable>{sessionToken ? <Pressable style={styles.logoutLink} onPress={() => void logout()}><Text style={styles.logoutLabel}>Salir</Text></Pressable> : null}</View></View>
      <View style={styles.card}>
        {!selectedService ? accountOpen && sessionToken ? <CustomerAccountPanel account={customerAccount} loading={accountLoading} requestingQuoteId={requestingQuoteId} deletingQuoteId={deletingQuoteId} message={accountMessage} onBack={() => navigateAccount(false)} onRequestExecution={(quoteId) => void requestExecution(quoteId)} onDeleteQuote={deleteQuote} /> : <>
          <Text style={styles.title}>¿Qué necesitas presupuestar?</Text><Text style={styles.subtitle}>Elige un servicio y te haré las preguntas necesarias para preparar tu solicitud.</Text><View style={styles.demoNotice}><Text style={styles.demoNoticeText}>Esta es una demo simplificada. En una instalación para tu empresa, el LLM dispone de más contexto, documentación y configuración propia para ofrecer respuestas más precisas.</Text><Pressable onPress={openDemoFaq} accessibilityRole="link"><Text style={styles.demoNoticeLink}>Consultar preguntas frecuentes →</Text></Pressable></View>
          {loading ? <ActivityIndicator color="#258269" size="large" style={styles.loader} /> : services.length === 0 ? <Text style={styles.empty}>No hay servicios publicados todavía.</Text> : <><TextInput style={styles.serviceSearch} value={serviceQuery} onChangeText={setServiceQuery} placeholder="Buscar un servicio…" autoCapitalize="none" /><Text style={styles.serviceSectionTitle}>{serviceQuery.trim() ? `Resultados para «${serviceQuery.trim()}»` : "Por favor, escoge un servicio para tu presupuesto"}</Text>{visibleServices.length === 0 ? <Text style={styles.empty}>No hemos encontrado ningún servicio con esa búsqueda.</Text> : <View style={[styles.services, { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-start", alignItems: "flex-start" }]}>{visibleServices.map((service) => { const imageUrl = service.image_url || `${API_URL}/media/products/noimage.png`; return <Pressable key={service.slug} style={[styles.service, { width: serviceCardWidth, flexDirection: "column", alignItems: "center", justifyContent: "flex-start", paddingBottom: 14 }]} onPress={() => chooseService(service)} disabled={sending}><View style={[styles.serviceIconWrap, { marginRight: 0, marginBottom: 12 }]}>{Platform.OS === "web" ? createElement("img", { src: imageUrl, alt: "", style: styles.serviceImage }) : <Image source={{ uri: imageUrl }} style={styles.serviceImage} />}</View><View style={[styles.serviceCopy, { alignItems: "center", width: "100%" }]}>{service.sector_pack_name ? <Text style={[styles.serviceCategory, { textAlign: "center" }]}>{service.sector_pack_name}</Text> : null}<Text style={[styles.serviceTitle, { textAlign: "center" }]}>{service.name}</Text><Text style={[styles.serviceDescription, { textAlign: "center" }]}>{service.description || "Preparar una solicitud de presupuesto."}</Text></View></Pressable>; })}</View>}{!serviceQuery.trim() && services.length > 10 ? <Text style={styles.serviceHint}>Mostramos los 10 servicios más recientes. Usa el buscador para localizar cualquier otro.</Text> : null}</>}
        </> : <>
          {!requestId && !sessionToken ? <View style={styles.contactStep}><Text style={styles.contactTitle}>Antes de empezar</Text><Text style={styles.subtitle}>Dinos tu nombre y email para poder identificar tu solicitud y entregarte el presupuesto cuando esté preparado.</Text><TextInput ref={customerNameRef} style={styles.inputFull} value={customerName} onChangeText={setCustomerName} placeholder="Tu nombre" autoFocus editable={!sending} returnKeyType="next" /><TextInput style={styles.inputFull} value={customerEmail} onChangeText={setCustomerEmail} placeholder="Tu email" keyboardType="email-address" autoCapitalize="none" editable={!sending} onSubmitEditing={() => void startConversation()} returnKeyType="send" /><Pressable style={styles.sendFull} onPress={() => void startConversation()} disabled={sending}><Text style={styles.sendLabel}>{sending ? "Preparando…" : "Continuar"}</Text></Pressable></View> : !requestId ? <ActivityIndicator color="#258269" size="large" style={styles.loader} /> : null}
          {requestId ? <>
          <View style={styles.chatHeader}><View><Text style={styles.title}>{selectedService.name}</Text><Text style={styles.subtitle}>Asistente de presupuesto</Text></View><Pressable onPress={restart}><Text style={styles.restart}>Cambiar servicio</Text></Pressable></View>
          <ScrollView ref={messagesScrollRef} style={styles.messages} contentContainerStyle={styles.messagesContent}>{messages.map((message, index) => <View key={`${message.sender}-${index}`} style={[styles.message, message.sender === "customer" ? styles.customerMessage : styles.assistantMessage]}><PublicMessageBody body={message.body} /></View>)}{sending ? <ActivityIndicator color="#258269" size="small" style={styles.chatLoader} /> : null}</ScrollView>
          {emailSent ? <View style={styles.accountBox}><Text style={styles.accountTitle}>Presupuesto enviado</Text><Text style={styles.accountText}>Te hemos enviado el presupuesto por email. El documento queda pendiente de revisión por la empresa.</Text></View> : emailFailed ? <View style={styles.accountBox}><Text style={styles.accountTitle}>No se ha podido enviar el presupuesto</Text><Text style={styles.accountText}>La solicitud se ha guardado correctamente, pero el envío de email necesita revisión de la configuración de correo.</Text></View> : null}
          {quoteAvailable && !sessionToken ? <View style={styles.accountBox}><Text style={styles.accountTitle}>Tu presupuesto ya está preparado</Text><Text style={styles.accountText}>Crea una contraseña para terminar el alta. Después recibirás el presupuesto por email.</Text><TextInput style={styles.inputFull} value={accountPassword} onChangeText={setAccountPassword} placeholder="Crea una contraseña (8 caracteres mínimo)" secureTextEntry editable={!completingAccount} /><TextInput style={styles.inputFull} value={accountPasswordConfirmation} onChangeText={setAccountPasswordConfirmation} placeholder="Repite la contraseña" secureTextEntry editable={!completingAccount} onSubmitEditing={() => void completeAccount()} returnKeyType="send" /><Pressable style={styles.sendFull} onPress={() => void completeAccount()} disabled={completingAccount}><Text style={styles.sendLabel}>{completingAccount ? "Activando cuenta…" : "Crear cuenta y recibir presupuesto"}</Text></Pressable></View> : emailSent || emailFailed ? null : conversationClosed ? <View style={styles.closedComposer}><Text style={styles.closedHint}>Esta conversación ha terminado. Puedes iniciar una nueva solicitud si lo necesitas.</Text><Pressable style={styles.newConversation} onPress={restart} disabled={sending}><Text style={styles.sendLabel}>Iniciar otra conversación</Text></Pressable></View> : activeField?.type === "boolean" ? <View style={styles.booleanComposer}><Text style={styles.booleanHint}>Selecciona una respuesta:</Text><View style={styles.booleanChoices}><Pressable style={styles.booleanButton} onPress={() => void sendMessage("sí")} disabled={sending}><Text style={styles.booleanButtonLabel}>Sí</Text></Pressable><Pressable style={styles.booleanButton} onPress={() => void sendMessage("no")} disabled={sending}><Text style={styles.booleanButtonLabel}>No</Text></Pressable></View></View> : activeField?.type === "color" ? <ColorPickerComposer field={activeField} disabled={sending} onSelect={(value) => void sendMessage(value)} /> : activeField?.type === "choice" && activeField.options?.length ? <ProductChoiceComposer field={activeField} disabled={sending} onSelect={(option, productSku) => void sendMessage(option, productSku)} /> : <View style={styles.composer}><TextInput ref={inputRef} style={styles.input} value={draft} onChangeText={setDraft} placeholder="Escribe tu respuesta…" editable={!sending} autoFocus onSubmitEditing={() => void sendMessage()} returnKeyType="send" /><Pressable style={styles.send} onPress={() => void sendMessage()} disabled={sending || !draft.trim()}><Text style={styles.sendLabel}>{sending ? "…" : "Enviar"}</Text></Pressable></View>}
          </> : null}
        </>}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View><Text style={styles.footer}>HorekIA · Conversación de solicitud de presupuesto</Text>
    <CustomerLoginModal visible={loginOpen} email={loginEmail} password={loginPassword} loading={loginLoading} error={loginError} onEmailChange={setLoginEmail} onPasswordChange={setLoginPassword} onSubmit={() => void login()} onClose={() => setLoginOpen(false)} />
    </ScrollView>
  </View>;
}

const styles: any = StyleSheet.create({
  shell: { flex: 1, backgroundColor: "#f6f7f5" }, demoRibbon: { position: "absolute", top: 32, left: -62, width: 245, paddingVertical: 9, backgroundColor: "#8e2232", alignItems: "center", justifyContent: "center", transform: [{ rotate: "-45deg" }], zIndex: 1000, elevation: 1000 }, demoRibbonText: { color: "#ffffff", fontSize: 11, lineHeight: 14, fontWeight: "900", letterSpacing: 0.4, textAlign: "center", textTransform: "uppercase" }, page: { width: "100%", maxWidth: 860, alignSelf: "center", padding: 32, minHeight: "100%" }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 32 }, brand: { color: "#17332d", fontSize: 22, fontWeight: "900", letterSpacing: 2 }, headerHint: { color: "#718078", fontSize: 15 }, headerRight: { flexDirection: "row", alignItems: "center", gap: 14 }, accountLink: { paddingVertical: 5 }, accountLinkLabel: { color: "#258269", fontSize: 13, fontWeight: "900" }, logoutLink: { paddingVertical: 5 }, logoutLabel: { color: "#a53d35", fontSize: 13, fontWeight: "900" }, card: { backgroundColor: "#ffffff", borderRadius: 18, borderWidth: 1, borderColor: "#dbe6df", padding: 28, minHeight: 520 }, title: { color: "#17332d", fontSize: 25, fontWeight: "900" }, subtitle: { color: "#61736a", fontSize: 15, lineHeight: 22, marginTop: 8 }, demoNotice: { backgroundColor: "#eef7f0", borderWidth: 1, borderColor: "#d5e8de", borderRadius: 10, padding: 14, marginTop: 20 }, demoNoticeText: { color: "#52645b", fontSize: 13, lineHeight: 19 }, demoNoticeLink: { color: "#258269", fontSize: 13, fontWeight: "900", marginTop: 8 }, loader: { marginTop: 90 }, empty: { color: "#61736a", marginTop: 36 }, serviceSearch: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 11, color: "#17332d", backgroundColor: "#fbfcfb", marginTop: 24 }, serviceSectionTitle: { color: "#285246", fontSize: 13, fontWeight: "900", marginTop: 22 }, serviceHint: { color: "#718078", fontSize: 12, lineHeight: 18, marginTop: 14 }, services: { gap: 12, marginTop: 12 }, service: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 12, padding: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, serviceIconWrap: { width: 56, height: 56, borderRadius: 10, backgroundColor: "#eef7f0", alignItems: "center", justifyContent: "center", marginRight: 14, overflow: "hidden" }, serviceImage: { width: 56, height: 56, objectFit: "contain" as any }, serviceCopy: { flex: 1 }, serviceCategory: { color: "#258269", fontSize: 11, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }, serviceTitle: { color: "#17332d", fontSize: 17, fontWeight: "900" }, serviceDescription: { color: "#718078", fontSize: 13, lineHeight: 19, marginTop: 5 }, serviceArrow: { color: "#258269", fontSize: 25, marginLeft: 18 }, accountHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 1, borderBottomColor: "#edf1ee", paddingBottom: 16, marginBottom: 18 }, profileBox: { backgroundColor: "#eef7f0", borderRadius: 12, padding: 16, marginBottom: 22 }, accountSectionTitle: { color: "#17332d", fontSize: 18, fontWeight: "900", marginBottom: 10 }, quoteList: { gap: 12 }, quoteCard: { borderWidth: 1, borderColor: "#dbe6df", borderRadius: 12, padding: 16, backgroundColor: "#fbfcfb" }, quoteHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, quoteStatus: { color: "#61736a", fontSize: 13, marginTop: 4 }, quoteDate: { color: "#718078", fontSize: 12, marginTop: 10 }, quoteActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 12 }, quoteActionMessage: { flex: 1, marginTop: 0 }, deleteQuoteButton: { borderWidth: 1, borderColor: "#e5b1ab", borderRadius: 9, paddingHorizontal: 14, paddingVertical: 11 }, deleteQuoteLabel: { color: "#a53d35", fontSize: 13, fontWeight: "900" }, quoteModalSubtitle: { color: "#258269", fontSize: 14, fontWeight: "900", marginTop: 4 }, quoteSummaryScroll: { maxHeight: 360, marginTop: 16 }, quoteSummaryLines: { borderTopWidth: 1, borderTopColor: "#edf1ee" }, quoteSummaryLine: { flexDirection: "row", justifyContent: "space-between", gap: 12, borderBottomWidth: 1, borderBottomColor: "#edf1ee", paddingVertical: 11 }, quoteSummaryDescription: { color: "#17332d", fontSize: 14, fontWeight: "900" }, quoteSummaryMeta: { color: "#718078", fontSize: 12, marginTop: 3 }, quoteSummaryAmount: { color: "#285246", fontSize: 14, fontWeight: "900" }, quoteSummaryTotals: { backgroundColor: "#eef7f0", borderRadius: 10, padding: 12, marginTop: 14 }, quoteTotalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }, quoteTotalLabel: { color: "#17332d", fontSize: 15, fontWeight: "900" }, quoteTotalValue: { color: "#17332d", fontSize: 20, fontWeight: "900" }, quoteConfirmText: { color: "#52645b", fontSize: 13, lineHeight: 19, marginTop: 15 }, modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 16 }, modalSecondaryButton: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 9, paddingHorizontal: 16, paddingVertical: 12 }, modalSecondaryLabel: { color: "#285246", fontSize: 13, fontWeight: "900" }, deleteQuoteConfirm: { backgroundColor: "#a53d35", borderRadius: 9, paddingHorizontal: 16, paddingVertical: 12 }, deleteQuoteWarning: { color: "#a53d35", backgroundColor: "#fdecea", borderRadius: 8, padding: 12, marginTop: 14, fontSize: 13, fontWeight: "900" }, composer: { flexDirection: "row", gap: 8, alignItems: "center" }, closedComposer: { borderWidth: 1, borderColor: "#dbe6df", borderRadius: 10, padding: 14, backgroundColor: "#fbfcfb" }, closedHint: { color: "#61736a", fontSize: 13, lineHeight: 19, marginBottom: 10 }, newConversation: { alignSelf: "flex-start", backgroundColor: "#258269", borderRadius: 9, paddingHorizontal: 17, paddingVertical: 12 }, input: { flex: 1, borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 11, color: "#17332d", backgroundColor: "#fbfcfb" }, send: { backgroundColor: "#258269", borderRadius: 9, paddingHorizontal: 17, paddingVertical: 12 }, sendLabel: { color: "#ffffff", fontSize: 13, fontWeight: "900" }, error: { color: "#a53d35", backgroundColor: "#fdecea", borderRadius: 8, padding: 12, marginTop: 18 }, modalBackdrop: { flex: 1, backgroundColor: "rgba(23, 51, 45, 0.36)", alignItems: "center", justifyContent: "center", padding: 24 }, modalCard: { width: "100%", maxWidth: 520, backgroundColor: "#ffffff", borderRadius: 16, padding: 24 }, modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, modalClose: { color: "#52645b", fontSize: 28, lineHeight: 28, paddingHorizontal: 6 }, footer: { color: "#718078", fontSize: 12, textAlign: "center", marginTop: 18 },
  choiceButtonHint: { color: "#d7eee3", fontSize: 10, fontWeight: "900", marginTop: 3 }, productChoiceWrap: { position: "relative", zIndex: 1 }, productChoiceWrapActive: { zIndex: 10000, elevation: 10000 }, productHoverPreview: { position: "absolute", zIndex: 10000, top: "100%", left: 0, width: 230, backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 10, padding: 11, shadowColor: "#000000", shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 10000 }, productHoverTitle: { color: "#17332d", fontSize: 12, fontWeight: "900" }, productHoverText: { color: "#285246", fontSize: 12, marginTop: 4 }, productHoverHint: { color: "#718078", fontSize: 11, marginTop: 6 }, productModalBackdrop: { flex: 1, backgroundColor: "rgba(23, 51, 45, 0.42)", alignItems: "center", justifyContent: "center", padding: 18 }, productModalCard: { width: "100%", maxWidth: 720, maxHeight: "88%", backgroundColor: "#ffffff", borderRadius: 18, padding: 22 }, productModalSubtitle: { color: "#258269", fontSize: 14, fontWeight: "900", marginTop: 3 }, productModalHint: { color: "#61736a", fontSize: 14, lineHeight: 20, marginTop: 12, marginBottom: 14 }, productList: { maxHeight: 520 }, productCard: { flexDirection: "row", gap: 14, borderWidth: 1, borderColor: "#dbe6df", borderRadius: 12, padding: 12, marginBottom: 10, backgroundColor: "#fbfcfb" }, productImage: { width: 96, height: 96, objectFit: "cover", borderRadius: 8, backgroundColor: "#eef2ef" }, productImagePlaceholder: { width: 96, height: 96, borderRadius: 8, backgroundColor: "#e5eee9", alignItems: "center", justifyContent: "center" }, productImageLabel: { color: "#61736a", fontSize: 11, fontWeight: "900" }, productCardCopy: { flex: 1 }, productName: { color: "#17332d", fontSize: 16, fontWeight: "900" }, productMetaStrong: { color: "#285246", fontSize: 13, fontWeight: "900", marginTop: 4 }, productMeta: { color: "#61736a", fontSize: 13, marginTop: 4 }, productDescription: { color: "#718078", fontSize: 12, lineHeight: 17, marginTop: 6 }, productPrice: { color: "#258269", fontSize: 13, fontWeight: "900", marginTop: 8 },
  headerBrand: { width: 190, height: 36, justifyContent: "center", backgroundColor: "transparent" },
  brandImage: { width: 190, height: 35, backgroundColor: "transparent" },
});

Object.assign(styles, {
  messageText: { color: "#285246", fontSize: 15, lineHeight: 21 },
  messageBold: { fontWeight: "900" },
  chatLoader: { alignSelf: "flex-start", margin: 8 },
  contactStep: { marginTop: 30, maxWidth: 560 },
  contactTitle: { color: "#17332d", fontSize: 20, fontWeight: "900" },
  inputFull: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 11, color: "#17332d", backgroundColor: "#fbfcfb", marginTop: 12 },
  sendFull: { alignSelf: "flex-start", backgroundColor: "#258269", borderRadius: 9, paddingHorizontal: 18, paddingVertical: 12, marginTop: 14 },
  accountBox: { backgroundColor: "#eef7f0", borderRadius: 12, padding: 16, marginBottom: 14 },
  accountTitle: { color: "#17332d", fontSize: 17, fontWeight: "900" },
  accountText: { color: "#61736a", fontSize: 13, lineHeight: 19, marginTop: 5 },
  quote: { backgroundColor: "#eef7f0", borderRadius: 12, padding: 16, marginBottom: 14 },
  quoteLabel: { color: "#285246", fontSize: 12, fontWeight: "900" },
  quoteValue: { color: "#17332d", fontSize: 25, fontWeight: "900" },
  quoteHint: { color: "#61736a", fontSize: 12, marginTop: 4 },
  quotePatterns: { borderTopWidth: 1, borderTopColor: "#edf1ee", marginTop: 14, paddingTop: 12 },
  quotePatternsTitle: { color: "#285246", fontSize: 12, fontWeight: "900", marginBottom: 6 },
  quotePattern: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 4 },
  quotePatternLabel: { color: "#61736a", fontSize: 12, flex: 1 },
  quotePatternResponse: { color: "#17332d", fontSize: 12, fontWeight: "900", flex: 1, textAlign: "right" },
  quoteBreakdown: { borderTopWidth: 1, borderTopColor: "#edf1ee", marginTop: 10, paddingTop: 12 },
  quoteBreakdownLine: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 4 },
  quoteBreakdownDescription: { color: "#52645b", fontSize: 12, flex: 1 },
  quoteBreakdownAmount: { color: "#285246", fontSize: 12, fontWeight: "900" },
  booleanComposer: { borderWidth: 1, borderColor: "#dbe6df", borderRadius: 10, padding: 12, backgroundColor: "#fbfcfb" },
  booleanHint: { color: "#61736a", fontSize: 12, marginBottom: 8 },
  booleanChoices: { flexDirection: "row", gap: 8 },
  booleanButton: { flex: 1, backgroundColor: "#258269", borderRadius: 8, alignItems: "center", paddingVertical: 11 },
  booleanButtonLabel: { color: "#ffffff", fontSize: 15, fontWeight: "900" },
  choiceComposer: { position: "relative", zIndex: 2000, overflow: "visible", borderWidth: 1, borderColor: "#dbe6df", borderRadius: 10, padding: 12, backgroundColor: "#fbfcfb" },
  choiceOptions: { position: "relative", zIndex: 2000, overflow: "visible", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choiceButton: { backgroundColor: "#258269", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 11 },
  choiceButtonLabel: { color: "#ffffff", fontSize: 15, fontWeight: "900" },
  colorComposer: { borderWidth: 1, borderColor: "#dbe6df", borderRadius: 10, padding: 12, backgroundColor: "#fbfcfb" },
  colorPickerButton: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: "#b7c8be", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: "#ffffff" },
  colorPickerDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: "#aebbb3" },
  colorPickerLabel: { color: "#285246", fontSize: 14, fontWeight: "900" },
  colorModalCard: { width: "100%", maxWidth: 680, maxHeight: "88%", backgroundColor: "#ffffff", borderRadius: 18, padding: 22 },
  colorSearch: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, marginTop: 16, color: "#17332d" },
  colorPaletteScroll: { maxHeight: 500, marginTop: 14 },
  colorPalette: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  colorSwatchButton: { width: 120, borderWidth: 1, borderColor: "#dbe6df", borderRadius: 10, padding: 8, backgroundColor: "#fbfcfb" },
  colorSwatch: { height: 52, borderRadius: 7, borderWidth: 1, borderColor: "#cbd8d1" },
  colorSwatchName: { color: "#285246", fontSize: 12, fontWeight: "900", marginTop: 6 },
  colorSwatchCode: { color: "#718078", fontSize: 11, marginTop: 2 },
  colorCustomHint: { color: "#61736a", fontSize: 12, lineHeight: 18, marginTop: 12 },
  colorCustomRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 8 },
  colorCustomInput: { flex: 1, borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, color: "#17332d" },
  colorCustomButton: { backgroundColor: "#258269", borderRadius: 9, paddingHorizontal: 14, paddingVertical: 11 },
  success: { color: "#216c55", backgroundColor: "#edf7f0", borderRadius: 8, padding: 12, marginTop: 16, fontSize: 13 },
  chatHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 1, borderBottomColor: "#edf1ee", paddingBottom: 16 },
  restart: { color: "#258269", fontSize: 12, fontWeight: "900", padding: 5 },
  messages: { height: 300, marginVertical: 18 },
  messagesContent: { gap: 10, paddingBottom: 8 },
  message: { maxWidth: "82%", borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10 },
  assistantMessage: { alignSelf: "flex-start", backgroundColor: "#f0f5f1" },
  customerMessage: { alignSelf: "flex-end", backgroundColor: "#dcefe4" },
});
