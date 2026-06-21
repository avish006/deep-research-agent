import re

class MathRenderer:
    """Utility to normalize LaTeX math delimiters for Markdown/Chainlit rendering."""
    
    @staticmethod
    def process_text(text: str) -> str:
        """
        Normalize LaTeX math delimiters to standard Markdown formats.
        
        Converts:
        - \\[ ... \\] -> $$ ... $$ (Display math)
        - \\( ... \\) -> $ ... $ (Inline math)
        
        This enables any standard markdown library (like python-markdown-math or Chainlit's KaTeX)
        to handle the rendering correctly, while avoiding false positives with [citations].
        """
        if not text:
            return text
            
        # Fix display math: \[ ... \] -> $$ ... $$
        # We use a pattern that matches \[ ... \] ensuring we don't break likely valid text
        text = re.sub(r'\\\[(.*?)\\\]', r'$$\1$$', text, flags=re.DOTALL)
        
        # Fix inline math: \( ... \) -> $ ... $
        # We need to be careful not to match standard text in parentheses
        text = re.sub(r'\\\((.*?)\\\)', r'$\1$', text, flags=re.DOTALL)
        
        return text

