"""PDF rendering for quote emails.

The standard first page contains deterministic quote data. If the tenant
uploaded a PDF template, its pages are appended as a branded annex during the
POC. A future template designer can replace this with mapped placeholders.
"""

from datetime import datetime
from io import BytesIO
from typing import Any
from xml.sax.saxutils import escape


def _money(value: Any) -> str:
    return f"{float(value):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _standard_pdf(*, tenant: dict[str, Any], customer: dict[str, Any], service: dict[str, Any], quote: dict[str, Any], calculation: dict[str, Any]) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    output = BytesIO()
    styles = getSampleStyleSheet()
    body = styles["BodyText"]
    body.fontName = "Helvetica"
    body.fontSize = 9
    body.leading = 12
    heading = styles["Heading1"]
    heading.fontName = "Helvetica-Bold"
    heading.textColor = colors.HexColor("#17332d")
    heading.fontSize = 21
    story: list[Any] = [Paragraph("Presupuesto", heading), Spacer(1, 5 * mm)]
    tenant_name = tenant.get("display_name") or tenant.get("legal_name") or "Empresa"
    story.append(Paragraph(f"<b>{tenant_name}</b>", body))
    company_address = " · ".join(str(value) for value in (tenant.get("address_line1"), tenant.get("postal_code"), tenant.get("city")) if value)
    if company_address:
        story.append(Paragraph(company_address, body))
    story.extend([Spacer(1, 4 * mm), Paragraph(f"<b>Servicio:</b> {service.get('name', 'Presupuesto')}", body)])
    story.append(Paragraph(f"<b>Cliente:</b> {customer.get('name') or 'Solicitante'} · {customer.get('email') or ''}", body))
    story.append(Paragraph(f"<b>Fecha:</b> {datetime.now().strftime('%d/%m/%Y')} · <b>Referencia:</b> {quote.get('id')}", body))
    story.append(Spacer(1, 7 * mm))
    patterns = calculation.get("patterns", [])
    if patterns:
        story.append(Paragraph("Patrones y configuración", heading))
        pattern_rows = [["Patrón", "Respuesta"]]
        for pattern in patterns:
            response = escape(str(pattern.get("response") or ""))
            if pattern.get("unit"):
                response = f"{response} {escape(str(pattern['unit']))}"
            if pattern.get("product_name"):
                response += f"<br/><font color='#61736a'>Producto: {escape(str(pattern['product_name']))}</font>"
            pattern_rows.append([escape(str(pattern.get("label") or pattern.get("key") or "Patrón")), response])
        pattern_table = Table(pattern_rows, colWidths=[92 * mm, 93 * mm], repeatRows=1)
        pattern_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef7f0")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#17332d")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#cbd8d1")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(pattern_table)
        story.append(Spacer(1, 6 * mm))
    story.append(Paragraph("Desglose económico", heading))
    rows = [["Concepto", "Cantidad", "Precio", "Importe"]]
    for line in calculation.get("lines", []):
        rows.append([
            str(line.get("description", "Concepto")),
            str(line.get("quantity", "")),
            f"{_money(line.get('unit_price', 0))} {quote.get('currency', 'EUR')}",
            f"{_money(line.get('amount', 0))} {quote.get('currency', 'EUR')}",
        ])
    table = Table(rows, colWidths=[92 * mm, 23 * mm, 35 * mm, 35 * mm], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dcefe4")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#17332d")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#cbd8d1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(table)
    story.extend([
        Spacer(1, 6 * mm),
        Paragraph(f"Subtotal: <b>{_money(quote.get('subtotal', 0))} {quote.get('currency', 'EUR')}</b>", body),
        Paragraph(f"Impuestos: <b>{_money(quote.get('tax_amount', 0))} {quote.get('currency', 'EUR')}</b>", body),
        Paragraph(f"Total orientativo: <b>{_money(quote.get('total', 0))} {quote.get('currency', 'EUR')}</b>", body),
    ])
    if tenant.get("disclaimers"):
        story.extend([Spacer(1, 6 * mm), Paragraph(f"<b>Condiciones:</b> {tenant['disclaimers']}", body)])
    if tenant.get("warranty_terms"):
        story.extend([Spacer(1, 2 * mm), Paragraph(f"<b>Garantía:</b> {tenant['warranty_terms']}", body)])
    SimpleDocTemplate(output, pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=18 * mm, bottomMargin=18 * mm).build(story)
    return output.getvalue()


def build_quote_pdf(*, tenant: dict[str, Any], customer: dict[str, Any], service: dict[str, Any], quote: dict[str, Any], calculation: dict[str, Any], template_content: bytes | None = None) -> bytes:
    standard = _standard_pdf(tenant=tenant, customer=customer, service=service, quote=quote, calculation=calculation)
    if not template_content:
        return standard
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    for source in (standard, template_content):
        reader = PdfReader(BytesIO(source))
        for page in reader.pages:
            writer.add_page(page)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()
