"""Configuration management for the Deep Research Agent."""

import os
from pathlib import Path
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# Load environment variables from .env file
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path)


class ResearchConfig(BaseModel):
    """Configuration for the research agent."""

    # Google Gemini API key
    google_api_key: str = Field(
        default_factory=lambda: os.getenv("GOOGLE_API_KEY", ""),
        description="Google Gemini API key (required)"
    )

    # Hardcoded to Google's most generous free model
    model_name: str = "gemini-3.5-flash"

    # Search Configuration
    max_search_queries: int = Field(
        default=int(os.getenv("MAX_SEARCH_QUERIES", "3")),
        description="Maximum number of search queries to generate"
    )

    max_search_results_per_query: int = Field(
        default=int(os.getenv("MAX_SEARCH_RESULTS_PER_QUERY", "3")),
        description="Maximum results to fetch per search query"
    )

    max_parallel_searches: int = Field(
        default=int(os.getenv("MAX_PARALLEL_SEARCHES", "1")),
        description="Maximum number of parallel search operations"
    )

    # Credibility Configuration
    min_credibility_score: int = Field(
        default=int(os.getenv("MIN_CREDIBILITY_SCORE", "40")),
        description="Minimum credibility score (0-100) to filter low-quality sources"
    )

    # Report Configuration
    max_report_sections: int = Field(
        default=int(os.getenv("MAX_REPORT_SECTIONS", "8")),
        description="Maximum number of sections in the final report"
    )

    min_section_words: int = Field(
        default=200,
        description="Minimum words per section"
    )

    citation_style: str = Field(
        default=os.getenv("CITATION_STYLE", "ieee"),
        description="Citation style (apa, mla, chicago, ieee)"
    )

    def validate_config(self) -> bool:
        """Validate that required configuration is present."""
        if not self.google_api_key:
            raise ValueError(
                "GOOGLE_API_KEY is required. "
                "Get a free key at https://aistudio.google.com/app/apikey"
            )
        return True


# Global configuration instance
config = ResearchConfig()

# Log configuration for debugging
import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logger.info(
    f"Configuration loaded - MAX_SEARCH_QUERIES: {config.max_search_queries}, "
    f"MAX_SEARCH_RESULTS_PER_QUERY: {config.max_search_results_per_query}, "
    f"MAX_REPORT_SECTIONS: {config.max_report_sections}"
)
