"""
Document parsers for knowledge ingestion pipeline.
Splits PDF/DOCX/PPTX/MD/TXT into structured chunks by headings/sections/slides.
Each chunk has: section (heading), page (if applicable), text (content).
"""

import re


def parse_pdf(file_path, logger):
    """Parse PDF into chunks by page, grouping by detected headings."""
    from pypdf import PdfReader
    reader = PdfReader(str(file_path))
    chunks = []
    current_section = "Introduction"
    current_text = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        lines = text.strip().split('\n')
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            is_heading = (
                (stripped.isupper() and 3 < len(stripped) < 100)
                or (len(stripped) < 80 and stripped.istitle() and not stripped.endswith('.'))
            )
            if is_heading and current_text:
                chunks.append({
                    'section': current_section,
                    'page': i + 1,
                    'text': '\n'.join(current_text).strip(),
                })
                current_text = []
                current_section = stripped
            else:
                current_text.append(stripped)
    if current_text:
        chunks.append({
            'section': current_section,
            'page': len(reader.pages),
            'text': '\n'.join(current_text).strip(),
        })
    logger.info(f"  PDF: {len(reader.pages)} pages → {len(chunks)} chunks")
    return chunks


def parse_docx(file_path, logger):
    """Parse DOCX into chunks by heading structure."""
    from docx import Document
    doc = Document(str(file_path))
    chunks = []
    current_section = "Introduction"
    current_text = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            continue
        style_name = (para.style.name or '').lower()
        is_heading = 'heading' in style_name
        if is_heading and current_text:
            chunks.append({
                'section': current_section,
                'page': None,
                'text': '\n'.join(current_text).strip(),
            })
            current_text = []
            current_section = text
        elif is_heading:
            current_section = text
        else:
            current_text.append(text)
    if current_text:
        chunks.append({
            'section': current_section,
            'page': None,
            'text': '\n'.join(current_text).strip(),
        })
    logger.info(f"  DOCX: {len(doc.paragraphs)} paragraphs → {len(chunks)} chunks")
    return chunks


def parse_pptx(file_path, logger):
    """Parse PPTX into chunks by slide."""
    from pptx import Presentation
    prs = Presentation(str(file_path))
    chunks = []
    for i, slide in enumerate(prs.slides):
        texts = []
        title = f"Slide {i + 1}"
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    text = para.text.strip()
                    if text:
                        texts.append(text)
            if hasattr(shape, "name") and "title" in shape.name.lower():
                if shape.has_text_frame and shape.text_frame.text.strip():
                    title = shape.text_frame.text.strip()
        if texts:
            chunks.append({
                'section': title,
                'page': i + 1,
                'text': '\n'.join(texts).strip(),
            })
    logger.info(f"  PPTX: {len(prs.slides)} slides → {len(chunks)} chunks")
    return chunks


def parse_markdown(file_path, logger):
    """Parse markdown into chunks by heading structure."""
    content = file_path.read_text(encoding='utf-8', errors='replace')
    chunks = []
    current_section = "Introduction"
    current_text = []
    for line in content.split('\n'):
        if line.startswith('#'):
            if current_text:
                chunks.append({
                    'section': current_section,
                    'page': None,
                    'text': '\n'.join(current_text).strip(),
                })
                current_text = []
            current_section = line.lstrip('#').strip()
        else:
            if line.strip():
                current_text.append(line)
    if current_text:
        chunks.append({
            'section': current_section,
            'page': None,
            'text': '\n'.join(current_text).strip(),
        })
    logger.info(f"  Markdown: {len(chunks)} chunks")
    return chunks


def parse_text(file_path, logger):
    """Parse plain text into chunks by blank-line-separated paragraphs."""
    content = file_path.read_text(encoding='utf-8', errors='replace')
    paragraphs = re.split(r'\n\s*\n', content)
    chunks = []
    for i, para in enumerate(paragraphs):
        text = para.strip()
        if text and len(text) > 20:
            chunks.append({
                'section': f"Section {i + 1}",
                'page': None,
                'text': text,
            })
    logger.info(f"  Text: {len(chunks)} chunks")
    return chunks


def parse_json(file_path, logger):
    """Parse JSON into chunks. Handles arrays of objects or nested structures."""
    import json
    content = file_path.read_text(encoding='utf-8', errors='replace')
    data = json.loads(content)
    chunks = []
    if isinstance(data, list):
        for i, item in enumerate(data):
            text = json.dumps(item, indent=2) if isinstance(item, dict) else str(item)
            section = item.get('title', item.get('name', item.get('key', f"Item {i + 1}"))) if isinstance(item, dict) else f"Item {i + 1}"
            chunks.append({'section': str(section), 'page': None, 'text': text})
    elif isinstance(data, dict):
        for key, value in data.items():
            text = json.dumps(value, indent=2) if isinstance(value, (dict, list)) else str(value)
            chunks.append({'section': key, 'page': None, 'text': text})
    logger.info(f"  JSON: {len(chunks)} chunks")
    return chunks


def parse_jsonl(file_path, logger):
    """Parse JSONL (one JSON object per line) into chunks."""
    import json
    lines = file_path.read_text(encoding='utf-8', errors='replace').strip().split('\n')
    chunks = []
    for i, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue
        try:
            item = json.loads(line)
            section = item.get('title', item.get('name', f"Line {i + 1}")) if isinstance(item, dict) else f"Line {i + 1}"
            text = json.dumps(item, indent=2) if isinstance(item, dict) else str(item)
            chunks.append({'section': str(section), 'page': None, 'text': text})
        except json.JSONDecodeError:
            chunks.append({'section': f"Line {i + 1}", 'page': None, 'text': line})
    logger.info(f"  JSONL: {len(chunks)} chunks")
    return chunks


def parse_csv(file_path, logger):
    """Parse CSV into chunks — one chunk per row, using headers as context."""
    import csv
    with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        chunks = []
        for i, row in enumerate(reader):
            text = '\n'.join(f"{k}: {v}" for k, v in row.items() if v and v.strip())
            section = row.get(reader.fieldnames[0], f"Row {i + 1}") if reader.fieldnames else f"Row {i + 1}"
            if text.strip():
                chunks.append({'section': str(section), 'page': None, 'text': text})
    logger.info(f"  CSV: {len(chunks)} chunks")
    return chunks


PARSERS = {
    '.pdf': parse_pdf,
    '.docx': parse_docx,
    '.pptx': parse_pptx,
    '.md': parse_markdown,
    '.txt': parse_text,
    '.json': parse_json,
    '.jsonl': parse_jsonl,
    '.csv': parse_csv,
}
