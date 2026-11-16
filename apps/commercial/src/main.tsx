import { StrictMode, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL ?? "https://api.horekia.com";

const faqs = [
  {
    question: "¿HorekIA sustituye el criterio de mi empresa?",
    answer: "No. La IA conversa, interpreta y ayuda a ordenar la petición. Tus productos, precios, reglas y revisión humana siguen bajo tu control.",
  },
  {
    question: "¿Puedo usarla en negocios muy distintos?",
    answer: "Sí. Puedes configurar servicios, preguntas, catálogo, conocimiento y reglas para una imprenta, una empresa de reformas, una cristalería o cualquier negocio que presupueste de forma personalizada.",
  },
  {
    question: "¿La IA puede inventarse un precio?",
    answer: "El motor de cálculo separa la conversación de la aritmética. Gemini puede interpretar una petición, pero los importes deben salir de productos, mano de obra y reglas deterministas que hayas configurado.",
  },
  {
    question: "¿Qué ocurre cuando falta información?",
    answer: "El asistente hace preguntas de seguimiento y puede pedir aclaraciones con un tono natural. Tu equipo revisa la solicitud antes de convertirla en una oferta definitiva.",
  },
];

const industries = [
  { icon: "01", title: "Reformas y obras", text: "Superficies, materiales, mano de obra, extras y condiciones según cada tipo de reforma." },
  { icon: "02", title: "Imprentas", text: "Formatos, tiradas, acabados, soportes, colores y productos de catálogo con contexto comercial." },
  { icon: "03", title: "Carpintería y vidrio", text: "Medidas, modelos, instalación, desmontaje y complementos para presupuestos a medida." },
  { icon: "04", title: "Servicios profesionales", text: "Convierte tu forma de trabajar, tus tarifas y tus criterios en una conversación guiada." },
];

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [contactStatus, setContactStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [contactMessage, setContactMessage] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const submitContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (contactStatus === "sending") return;
    const form = new FormData(event.currentTarget);
    setContactStatus("sending");
    setContactMessage("");
    try {
      const response = await fetch(`${API_URL}/api/v1/public/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          company: form.get("company"),
          phone: form.get("phone"),
          sector: form.get("sector"),
          message: form.get("message"),
          privacyAcknowledged: form.get("privacyAcknowledged") === "on",
          website: form.get("website"),
        }),
      });
      const result = await response.json().catch(() => ({})) as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "No se ha podido enviar la solicitud. Inténtalo de nuevo.");
      event.currentTarget.reset();
      setContactStatus("success");
      setContactMessage("Gracias. Hemos recibido tu consulta y te responderemos por email.");
    } catch (error) {
      setContactStatus("error");
      setContactMessage(error instanceof Error ? error.message : "No se ha podido enviar la solicitud. Inténtalo de nuevo.");
    }
  };

  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="HorekIA, inicio">
          <img src="/horekia-logo.svg" alt="HorekIA" />
        </a>
        <button className="menu-toggle" aria-label="Abrir menú" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
          <span />
          <span />
        </button>
        <nav className={menuOpen ? "main-nav is-open" : "main-nav"} aria-label="Navegación principal">
          <a href="#como-funciona" onClick={() => setMenuOpen(false)}>Cómo funciona</a>
          <a href="#valor" onClick={() => setMenuOpen(false)}>Valor IA</a>
          <a href="#sectores" onClick={() => setMenuOpen(false)}>Sectores</a>
          <a href="#contacto" onClick={() => setMenuOpen(false)}>Contacto</a>
          <a href="#preguntas" onClick={() => setMenuOpen(false)}>Preguntas</a>
          <a className="nav-cta" href="https://app.horekia.com">Ver la experiencia <span>↗</span></a>
        </nav>
      </header>

      <main id="top">
        <section className="hero section-pad">
          <div className="hero-copy">
            <p className="eyebrow"><span className="eyebrow-dot" /> IA conversacional para presupuestar mejor</p>
            <h1>Tu forma de trabajar, convertida en <em>una conversación inteligente.</em></h1>
            <p className="hero-lede">HorekIA entiende lo que necesita tu cliente, consulta el conocimiento de tu negocio y prepara una solicitud de presupuesto con contexto, precisión y un trato cercano.</p>
            <div className="hero-actions">
              <a className="button button-primary" href="https://app.horekia.com">Probar la experiencia <span>→</span></a>
              <a className="text-link" href="#contacto">Hablar con el equipo <span>↗</span></a>
            </div>
            <div className="hero-proof"><span>Conocimiento propio</span><span>·</span><span>Reglas controlables</span><span>·</span><span>Revisión humana</span></div>
          </div>
          <div className="hero-visual" aria-label="Ejemplo de conversación de HorekIA">
            <div className="visual-glow" />
            <div className="chat-window">
              <div className="chat-topbar"><span className="window-dots"><i /><i /><i /></span><span>Asistente de presupuesto</span><b>•••</b></div>
              <div className="chat-context"><span className="context-mark">H</span><div><strong>Reforma de baño</strong><small>Solicitud en contexto</small></div><span className="live-dot" /></div>
              <div className="chat-messages">
                <div className="bubble bubble-ai">Hola, Rafa. ¿Qué te gustaría reformar y qué problema quieres resolver?</div>
                <div className="bubble bubble-user">Quiero renovar el baño y necesito cambiar el suelo.</div>
                <div className="bubble bubble-ai">Perfecto. Te preguntaré lo necesario para calcular una opción adecuada. ¿Qué superficie aproximada tiene el suelo?</div>
                <div className="chat-calc"><span className="calc-icon">✓</span><div><small>Cálculo preparado</small><strong>Superficie × material + instalación</strong></div><span className="calc-arrow">↗</span></div>
              </div>
              <div className="chat-input"><span>Escribe tu respuesta...</span><button aria-label="Enviar">↑</button></div>
            </div>
            <div className="float-card float-card-top"><span className="float-icon">✦</span><div><strong>IA con contexto</strong><small>Conoce tu catálogo y tu forma de vender.</small></div></div>
            <div className="float-card float-card-bottom"><span className="float-check">✓</span><div><strong>Reglas deterministas</strong><small>La conversación no decide el precio.</small></div></div>
          </div>
        </section>

        <section className="signal-bar"><div><strong>Una conversación natural</strong><span>para el cliente</span></div><div><strong>Un sistema configurable</strong><span>para tu empresa</span></div><div><strong>Un presupuesto trazable</strong><span>para todos</span></div></section>

        <section className="story section-pad" id="valor">
          <div className="section-heading narrow"><p className="eyebrow">El problema</p><h2>Tu negocio no cabe en un formulario.</h2><p>Un cliente no siempre sabe qué dato debe darte. A veces explica su necesidad con sus propias palabras, mezcla varias opciones o necesita que alguien le ayude a concretarla.</p></div>
          <div className="story-grid">
            <article className="story-card story-card-muted"><span className="card-number">01</span><h3>Un formulario pregunta campos.</h3><p>El cliente tiene que entender tu modelo interno antes de poder pedir ayuda.</p><div className="fake-form"><span>Tipo de reforma</span><span>Superficie</span><span>Material</span><span>...</span></div></article>
            <article className="story-card story-card-accent"><span className="card-number">02</span><h3>HorekIA entiende intenciones.</h3><p>El cliente explica lo que necesita. La IA ordena la conversación y detecta qué falta.</p><div className="intent-cloud"><span>«Quiero algo resistente»</span><span>«No sé qué material elegir»</span><span>«¿Podéis instalarlo?»</span></div></article>
            <article className="story-card story-card-dark"><span className="card-number">03</span><h3>Tu negocio pone los límites.</h3><p>Catálogo, conocimiento y reglas hacen que la respuesta sea útil para tu negocio, no una respuesta genérica.</p><div className="rule-list"><span><b>✓</b> Productos disponibles</span><span><b>✓</b> Precios y unidades</span><span><b>✓</b> Criterios de revisión</span></div></article>
          </div>
        </section>

        <section className="ai-section section-pad" id="como-funciona">
          <div className="section-heading"><p className="eyebrow">La diferencia HorekIA</p><h2>La IA conversa.<br /><em>Tu negocio decide.</em></h2><p>La inteligencia está en combinar interpretación libre con información y cálculos que puedes revisar.</p></div>
          <div className="ai-flow">
            <div className="flow-block flow-conversation"><span className="flow-label">01 · Conversación</span><h3>El cliente habla como habla.</h3><p>Gemini interpreta peticiones, dudas y respuestas naturales dentro del servicio que ha elegido.</p><div className="mini-chat"><span>«Quiero una ventana que aisle más el ruido.»</span><b>→</b><span>«¿Qué espacio tenemos y qué tipo de apertura prefieres?»</span></div></div>
            <div className="flow-connector"><span>+</span></div>
            <div className="flow-block flow-knowledge"><span className="flow-label">02 · Conocimiento</span><h3>Tu negocio aporta el contexto.</h3><p>Productos, fichas, documentos, precios y criterios propios alimentan respuestas más relevantes.</p><div className="knowledge-stack"><span>Catálogo de productos</span><span>Base de conocimiento</span><span>Patrones de servicio</span></div></div>
            <div className="flow-connector"><span>→</span></div>
            <div className="flow-block flow-result"><span className="flow-label">03 · Resultado</span><h3>Una solicitud lista para revisar.</h3><p>El motor calcula con reglas deterministas y deja claro qué se ha tenido en cuenta.</p><div className="result-total"><small>Estimación orientativa</small><strong>1.280,00 €</strong><span>Materiales · mano de obra · extras</span></div></div>
          </div>
        </section>

        <section className="benefits section-pad">
          <div className="section-heading narrow"><p className="eyebrow">Más que un chatbot</p><h2>Una capa inteligente sobre tu forma de vender.</h2></div>
          <div className="benefit-grid"><article><span className="benefit-icon">⌁</span><h3>Responde con tu contexto</h3><p>La IA no parte de cero. Aprende la estructura de tus servicios, tus productos y la forma en que quieres preguntar.</p></article><article><span className="benefit-icon">◌</span><h3>Pregunta solo lo necesario</h3><p>Si una respuesta abre una nueva posibilidad, el asistente profundiza. Si no aplica, no la fuerza.</p></article><article><span className="benefit-icon">⊞</span><h3>Calcula sin improvisar</h3><p>Las reglas de precio, mínimos, descuentos, mano de obra y extras quedan separadas de la conversación.</p></article><article><span className="benefit-icon">↗</span><h3>Escala con tu catálogo</h3><p>Empieza con una configuración sencilla y amplía servicios, productos y conocimiento a medida que creces.</p></article></div>
        </section>

        <section className="sectors section-pad" id="sectores">
          <div className="section-heading"><p className="eyebrow">Un modelo agnóstico</p><h2>La IA se adapta a tu negocio,<br /><em>no al revés.</em></h2><p>HorekIA sirve allí donde cada presupuesto necesita conversación, criterio y contexto.</p></div>
          <div className="sector-grid">{industries.map((industry) => <article className="sector-card" key={industry.title}><span className="sector-icon">{industry.icon}</span><h3>{industry.title}</h3><p>{industry.text}</p><span className="sector-arrow">↗</span></article>)}</div>
        </section>

        <section className="steps section-pad" id="proceso">
          <div className="steps-intro"><p className="eyebrow">Empieza por tu negocio</p><h2>Configura una vez.<br /><em>Conversa cada día.</em></h2><p>HorekIA pone el conocimiento en manos de tu equipo para que cada nueva solicitud empiece mejor que la anterior.</p><a className="button button-dark" href="https://backoffice.horekia.com">Conocer el backoffice <span>↗</span></a></div>
          <div className="step-list"><div className="step-item"><span>01</span><div><h3>Define tus servicios</h3><p>Crea las opciones de presupuesto que tu empresa ofrece.</p></div></div><div className="step-item"><span>02</span><div><h3>Añade tu conocimiento</h3><p>Sube documentos, catálogos y criterios que la IA debe asumir.</p></div></div><div className="step-item"><span>03</span><div><h3>Configura tus reglas</h3><p>Decide cómo se calculan productos, mano de obra y extras.</p></div></div><div className="step-item"><span>04</span><div><h3>Revisa y mejora</h3><p>Observa las solicitudes y afina la experiencia de tus clientes.</p></div></div></div>
        </section>

        <section className="contact-section section-pad" id="contacto">
          <div className="contact-intro"><p className="eyebrow">Hablemos de tu negocio</p><h2>Cuéntanos qué quieres <em>presupuestar mejor.</em></h2><p>Te enseñaremos cómo puede conversar HorekIA con tus clientes y qué necesitaríamos para adaptar la experiencia a tu forma de trabajar.</p><div className="contact-note"><span>↗</span><p>Sin compromiso y sin una demo genérica. Partimos de un caso real de tu empresa.</p></div></div>
          <form className="contact-form" onSubmit={submitContact} noValidate>
            <div className="form-row"><label>Nombre y apellidos<input name="name" autoComplete="name" required minLength={2} maxLength={160} placeholder="Tu nombre" /></label><label>Email profesional<input name="email" type="email" autoComplete="email" required maxLength={240} placeholder="tu@empresa.com" /></label></div>
            <div className="form-row"><label>Empresa<input name="company" autoComplete="organization" required minLength={2} maxLength={160} placeholder="Nombre de tu empresa" /></label><label>Teléfono <span>(opcional)</span><input name="phone" type="tel" autoComplete="tel" maxLength={80} placeholder="600 000 000" /></label></div>
            <label>¿En qué sector trabajas?<select name="sector" defaultValue=""><option value="">Selecciona una opción</option><option>Reformas y construcción</option><option>Imprenta y artes gráficas</option><option>Carpintería, aluminio y vidrio</option><option>Servicios profesionales</option><option>Otro</option></select></label>
            <label>¿Qué te gustaría mejorar?<textarea name="message" required minLength={10} maxLength={4000} rows={5} placeholder="Cuéntanos cómo recibes hoy las solicitudes y qué te gustaría que hiciera HorekIA..." /></label>
            <div className="honey-field" aria-hidden="true"><label>Deja este campo vacío<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
            <label className="consent"><input name="privacyAcknowledged" type="checkbox" required /><span>Acepto que HorekIA utilice estos datos para responder a mi consulta comercial.</span></label>
            <button className="button button-primary form-submit" type="submit" disabled={contactStatus === "sending"}>{contactStatus === "sending" ? "Enviando…" : "Enviar mi consulta"}<span>→</span></button>
            {contactMessage ? <p className={contactStatus === "error" ? "form-message is-error" : "form-message is-success"} role={contactStatus === "error" ? "alert" : "status"}>{contactMessage}</p> : null}
          </form>
        </section>

        <section className="faq section-pad" id="preguntas"><div className="section-heading narrow"><p className="eyebrow">Preguntas frecuentes</p><h2>Claro para tu equipo.<br /><em>Natural para tu cliente.</em></h2></div><div className="faq-list">{faqs.map((faq, index) => <div className={openFaq === index ? "faq-item is-open" : "faq-item"} key={faq.question}><button onClick={() => setOpenFaq(openFaq === index ? null : index)} aria-expanded={openFaq === index}><span>{faq.question}</span><b>{openFaq === index ? "−" : "+"}</b></button>{openFaq === index ? <p>{faq.answer}</p> : null}</div>)}</div></section>

        <section className="final-cta section-pad"><div className="cta-orbit orbit-one" /><div className="cta-orbit orbit-two" /><p className="eyebrow">El siguiente presupuesto puede empezar aquí</p><h2>Haz que tu experiencia de venta<br /><em>esté a la altura de tu negocio.</em></h2><p>Descubre cómo se siente pedir un presupuesto a una empresa que entiende lo que necesitas.</p><a className="button button-light" href="https://app.horekia.com">Probar HorekIA <span>→</span></a></section>
      </main>

      <footer className="site-footer"><div className="footer-brand"><img src="/horekia-logo.svg" alt="HorekIA" /><p>IA conversacional para presupuestar con criterio.</p></div><div className="footer-links"><div><strong>Explora</strong><a href="#como-funciona">Cómo funciona</a><a href="#valor">Valor IA</a><a href="#sectores">Sectores</a></div><div><strong>Acceso</strong><a href="https://app.horekia.com">Solicitar presupuesto</a><a href="https://backoffice.horekia.com">Backoffice</a></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} HorekIA</span><span>Presupuestos que empiezan con una conversación.</span></div></footer>
    </div>
  );
}

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", name: "HorekIA", url: "https://www.horekia.com/", logo: "https://www.horekia.com/horekia-commercial-favicon-512.png", description: "Plataforma de IA conversacional para preparar presupuestos adaptados al conocimiento y las reglas de cada negocio." },
    { "@type": "SoftwareApplication", name: "HorekIA", applicationCategory: "BusinessApplication", operatingSystem: "Web", url: "https://www.horekia.com/", description: "Asistente de IA para interpretar solicitudes de presupuesto, consultar conocimiento de negocio y aplicar cálculos controlables." },
    { "@type": "FAQPage", mainEntity: faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) },
  ],
};

const structuredDataScript = document.createElement("script");
structuredDataScript.type = "application/ld+json";
structuredDataScript.textContent = JSON.stringify(structuredData);
document.head.appendChild(structuredDataScript);

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
