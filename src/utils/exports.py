"""Export research reports to various formats."""
from pathlib import Path
import logging
import markdown
from datetime import datetime
from src.utils.math_renderer import MathRenderer
logger = logging.getLogger(__name__)

class ReportExporter:
    """Export reports to various formats."""
    
    def __init__(self):
        self.supported_formats = ['markdown', 'html', 'txt']
    
    def export_markdown(self, content: str, output_path: Path) -> Path:
        """Export as markdown (already in markdown format)."""
        output_path.write_text(content, encoding='utf-8')
        logger.info(f"Exported markdown to {output_path}")
        return output_path
    
    def export_html(self, content: str, output_path: Path) -> Path:
        """Export as HTML using standard mdx_math extension for LaTeX."""
        from datetime import datetime
        
        # We still fix the non-standard LLM brackets once before conversion
        # but let the library handle all the complex LaTeX logic
        from src.utils.math_renderer import MathRenderer
        content = MathRenderer.process_text(content)
        
        # Convert markdown to HTML with standard math extension
        html_body = markdown.markdown(
            content,
            extensions=['extra', 'codehilite', 'tables', 'nl2br', 'mdx_math'],
            extension_configs={
                'mdx_math': {'enable_dollar_delimiter': True}
            }
        )
        
        html_template = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Research Report</title>
    <script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js" async></script>
    <style>
        body {{ font-family: sans-serif; line-height: 1.6; max-width: 900px; margin: 0 auto; padding: 20px; color: #333; }}
        h1 {{ color: #2c3e50; border-bottom: 3px solid #3498db; }}
        table {{ border-collapse: collapse; width: 100%; margin: 20px 0; }}
        th, td {{ border: 1px solid #ddd; padding: 12px; }}
        .footer {{ margin-top: 40px; color: #7f8c8d; font-size: 0.8em; }}
    </style>
</head>
<body>
    {html_body}
    <div class="footer">Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</div>
</body>
</html>"""
        
        output_path.write_text(html_template, encoding='utf-8')
        return output_path
    
    def export_txt(self, content: str, output_path: Path) -> Path:
        """Export as plain text."""
        import re
        text = content
        text = re.sub(r'^#+\s+', '', text, flags=re.MULTILINE)
        text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
        text = re.sub(r'\*([^*]+)\*', r'\1', text)
        text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
        text = re.sub(r'```[^`]+```', '', text, flags=re.DOTALL)
        text = re.sub(r'`([^`]+)`', r'\1', text)
        output_path.write_text(text, encoding='utf-8')
        logger.info(f"Exported text to {output_path}")
        return output_path
    
    def export(self, content: str, output_path: Path, format: str = 'markdown') -> Path:
        """Export content to specified format."""
        format = format.lower()
        if format not in self.supported_formats:
            raise ValueError(f"Unsupported format: {format}. Supported: {self.supported_formats}")
        
        if format == 'html' and output_path.suffix != '.html':
            output_path = output_path.with_suffix('.html')
        elif format == 'txt' and output_path.suffix != '.txt':
            output_path = output_path.with_suffix('.txt')
        elif format == 'markdown' and output_path.suffix not in ['.md', '.markdown']:
            output_path = output_path.with_suffix('.md')
        
        if format == 'markdown':
            return self.export_markdown(content, output_path)
        elif format == 'html':
            return self.export_html(content, output_path)
        elif format == 'txt':
            return self.export_txt(content, output_path)
        else:
            raise ValueError(f"Export not implemented for format: {format}")