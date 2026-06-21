"""Agent nodes for the research workflow."""

import asyncio
from typing import List
import logging

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser, JsonOutputParser

from src.state import ResearchState, ResearchPlan, SearchQuery, ReportSection
from src.utils.tools import get_research_tools
from src.config import config
from src.utils.credibility import CredibilityScorer
from src.utils.citations import CitationFormatter
from src.llm_tracker import estimate_tokens
from src.callbacks import (
    emit_planning_start, emit_planning_complete,
    emit_search_start, emit_search_results,
    emit_extraction_start, emit_extraction_complete,
    emit_writing_start, emit_writing_section, emit_writing_complete,
    emit_error
)
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def get_llm(temperature: float = 0.7):
    """Return a ChatGoogleGenerativeAI instance using the hardcoded Gemini model."""
    logger.info(f"Using Google Gemini model: {config.model_name}")
    return ChatGoogleGenerativeAI(
        model=config.model_name,
        google_api_key=config.google_api_key,
        temperature=temperature,
        max_retries=10,
    )


class ResearchPlanner:
    """Autonomous agent responsible for planning research strategy."""
    
    def __init__(self):
        self.llm = get_llm(temperature=0.7)
        # Note: Planning agent uses LLM directly with structured output for reliability
        # Tool calling works better for search/extraction tasks
        self.max_retries = 3
        
    async def plan(self, state: ResearchState) -> dict:
        """Create a research plan with structured LLM output.
        
        Returns dict with updates that LangGraph will merge into state.
        """
        logger.info(f"Planning research for: {state.research_topic}")
        
        # Emit progress update
        await emit_planning_start(state.research_topic)
        
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an expert research strategist and information architect. Your role is to create comprehensive, methodical research plans that maximize accuracy and depth of coverage.

## Your Core Responsibilities

### 1. Define SMART Research Objectives (3-5 objectives)
Create objectives that are:
- **Specific**: Target concrete aspects of the topic, not vague generalities
- **Measurable**: Can be verified as addressed in the final report
- **Achievable**: Realistically answerable through web research
- **Relevant**: Directly address the user's query and implied needs
- **Time-aware**: Consider current state, recent developments, and future outlook

### 2. Design Strategic Search Queries (up to {max_queries} queries)

**Query Diversity Matrix** - Ensure coverage across:
- **Definitional queries**: "What is [topic]" / "[topic] explained"
- **Mechanism queries**: "How does [topic] work" / "[topic] architecture"
- **Comparison queries**: "[topic] vs alternatives" / "[topic] comparison"
- **Expert/authoritative queries**: "[topic] research paper" / "[topic] official documentation"
- **Practical queries**: "[topic] best practices" / "[topic] implementation guide"
- **Trend queries**: "[topic] 2024" / "latest [topic] developments"
- **Problem/solution queries**: "[topic] challenges" / "[topic] limitations"

**Query Quality Guidelines**:
- Use specific technical terms when appropriate
- Include year markers for time-sensitive topics (e.g., "2024", "latest")
- Add domain qualifiers for targeted results (e.g., "academic", "enterprise", "tutorial")
- Avoid overly broad single-word queries
- Consider alternative phrasings and synonyms

### 3. Structure the Report Outline (up to {max_sections} sections)

Create a logical flow that:
- Starts with context/background (helps readers understand the landscape)
- Progresses from fundamentals to advanced topics
- Groups related concepts together
- Ends with practical implications, conclusions, or future outlook
- Includes a dedicated section for technical details if applicable

**Recommended Section Types**:
- Executive Summary / Overview
- Background & Context  
- Core Concepts / How It Works
- Key Features / Components / Architecture
- Benefits & Advantages
- Challenges & Limitations
- Use Cases / Applications
- Comparison with Alternatives (if relevant)
- Best Practices / Implementation Guidelines
- Future Outlook / Trends
- Conclusion & Recommendations

## Output Quality Standards
- Every search query must have a clear, distinct purpose
- No redundant or overlapping queries
- Report sections should comprehensively cover all objectives
- Consider the user's apparent expertise level when designing the plan"""),
            ("human", """Research Topic: {topic}

Analyze this topic carefully. Consider:
1. What is the user really trying to understand?
2. What are the key dimensions of this topic?
3. What authoritative sources would have the best information?
4. What technical depth is appropriate?

Create a detailed research plan in JSON format:
{{
    "topic": "the research topic (refined if needed for clarity)",
    "objectives": [
        "Specific, measurable objective 1",
        "Specific, measurable objective 2",
        ...
    ],
    "search_queries": [
        {{"query": "well-crafted search query 1", "purpose": "specific reason this query helps achieve objectives"}},
        {{"query": "well-crafted search query 2", "purpose": "specific reason this query helps achieve objectives"}},
        ...
    ],
    "report_outline": [
        "Section 1: Logical starting point",
        "Section 2: Building on Section 1",
        ...
    ]
}}

Ensure each query targets different aspects and the outline tells a coherent story.""")
        ])
        
        for attempt in range(self.max_retries):
            try:
                start_time = time.time()
                chain = prompt | self.llm | JsonOutputParser()
                
                # Estimate input tokens
                input_text = f"{state.research_topic} {config.max_search_queries} {config.max_report_sections}"
                input_tokens = estimate_tokens(input_text)
                
                result = await chain.ainvoke({
                    "topic": state.research_topic,
                    "max_queries": config.max_search_queries,
                    "max_sections": config.max_report_sections
                })
                
                # Track LLM call
                duration = time.time() - start_time
                output_tokens = estimate_tokens(str(result))
                call_detail = {
                    'agent': 'ResearchPlanner',
                    'operation': 'plan',
                    'model': config.model_name,
                    'input_tokens': input_tokens,
                    'output_tokens': output_tokens,
                    'duration': round(duration, 2),
                    'attempt': attempt + 1
                }
                
                # Validate result structure
                if not all(key in result for key in ["topic", "objectives", "search_queries", "report_outline"]):
                    raise ValueError("Invalid plan structure returned")
                
                if not result["search_queries"]:
                    raise ValueError("No search queries generated")
                
                # Convert to ResearchPlan
                plan_data = result
                
                # Validate result structure
                if not all(key in plan_data for key in ["topic", "objectives", "search_queries", "report_outline"]):
                    raise ValueError("Invalid plan structure returned")
                
                if not plan_data["search_queries"]:
                    raise ValueError("No search queries generated")
                
                # Convert to ResearchPlan with HARD LIMITS enforced
                plan = ResearchPlan(
                    topic=plan_data["topic"],
                    objectives=plan_data["objectives"][:5],  # Max 5 objectives
                    search_queries=[
                        SearchQuery(query=sq["query"], purpose=sq["purpose"])
                        for sq in plan_data["search_queries"][:config.max_search_queries]
                    ],
                    report_outline=plan_data["report_outline"][:config.max_report_sections]
                )
                
                logger.info(f"Created plan with {len(plan.search_queries)} queries (enforced max: {config.max_search_queries})")
                logger.info(f"Report outline has {len(plan.report_outline)} sections (enforced max: {config.max_report_sections})")
                
                # Emit progress update
                await emit_planning_complete(len(plan.search_queries), len(plan.report_outline))
                
                # Return dict updates - LangGraph merges into state
                return {
                    "plan": plan,
                    "current_stage": "searching",
                    "iterations": state.iterations + 1,
                    "llm_calls": state.llm_calls + 1,
                    "total_input_tokens": state.total_input_tokens + input_tokens,
                    "total_output_tokens": state.total_output_tokens + output_tokens,
                    "llm_call_details": state.llm_call_details + [call_detail]
                }
                
            except Exception as e:
                logger.warning(f"Planning attempt {attempt + 1} failed: {str(e)}")
                if attempt == self.max_retries - 1:
                    logger.error(f"Planning failed after {self.max_retries} attempts")
                    return {
                        "error": f"Planning failed: {str(e)}",
                        "iterations": state.iterations + 1
                    }
                else:
                    await asyncio.sleep(2 ** attempt)
        
        # Fallback if all retries exhausted
        return {
            "error": "Planning failed: Maximum retries exceeded",
            "iterations": state.iterations + 1
        }


class ResearchSearcher:
    """Autonomous agent responsible for executing research searches."""
    
    def __init__(self):
        self.llm = get_llm(temperature=0.3)
        self.tools = get_research_tools(agent_type="search")
        self.credibility_scorer = CredibilityScorer()
        self.max_retries = 3
        
    async def search(self, state: ResearchState) -> dict:
        """Mechanically execute planned queries â€” zero LLM calls in this phase."""
        if not state.plan:
            await emit_error("No research plan available")
            return {"error": "No research plan available"}

        logger.info(f"Mechanical search: {len(state.plan.search_queries)} queries")

        from src.utils.web_utils import WebSearchTool, ContentExtractor
        from src.state import SearchResult as SR
        search_tool = WebSearchTool(max_results=config.max_search_results_per_query)
        extractor = ContentExtractor(timeout=12)

        all_results: list = []
        all_scores: list = []
        total_queries = len(state.plan.search_queries)

        for i, query in enumerate(state.plan.search_queries, 1):
            await emit_search_start(query.query, i, total_queries)
            try:
                raw = await search_tool.search_async(query.query)
            except Exception as e:
                logger.warning(f"Search failed for '{query.query}': {e}")
                raw = []

            await emit_search_results(len(raw), i, total_queries)

            # Score credibility and pick top 2 to extract full content
            scored = []
            for r in raw:
                score = self.credibility_scorer.score_url(r.url)
                if score.get("score", 0) >= config.min_credibility_score:
                    scored.append((r, score))
            scored.sort(key=lambda x: x[1].get("score", 0), reverse=True)

            for r, score in scored[:2]:
                await emit_extraction_start(r.url, i, total_queries)
                try:
                    extracted = await extractor.extract_content_async(r.url)
                    if extracted:
                        r.content = extracted
                        logger.info(f"Extracted {len(r.content)} chars from {r.url}")
                except Exception as e:
                    logger.warning(f"Extraction failed for {r.url}: {e}")

                all_results.append(r)
                all_scores.append(score)

            # Add lower-score results (snippet-only) for breadth
            for r, score in scored[2:]:
                all_results.append(r)
                all_scores.append(score)

            await asyncio.sleep(1)  # polite rate limiting between queries

        logger.info(f"Search complete: {len(all_results)} results, "
                    f"{sum(1 for r in all_results if r.content)} with full content")
                    
        extracted_count = sum(1 for r in all_results if r.content)
        total_extracted_chars = sum(len(r.content) for r in all_results if r.content)
        await emit_extraction_complete(extracted_count, total_extracted_chars)

        return {
            "search_results": all_results,
            "credibility_scores": all_scores,
            "current_stage": "writing",
            "iterations": state.iterations + 1,
        }


class ReportWriter:
    """Autonomous agent responsible for writing research reports."""
    
    def __init__(self, citation_style: str = 'apa'):
        self.llm = get_llm(temperature=0.7)
        self.tools = get_research_tools(agent_type="writing")
        self.max_retries = 3
        self.citation_style = citation_style
        self.citation_formatter = CitationFormatter()
        
    async def write_report(self, state: ResearchState) -> dict:
        """Write the final research report with validation and retry.
        
        Returns dict with report data that LangGraph will merge into state.
        """
        logger.info("Writing final report")
        
        if not state.plan or not state.search_results:
            await emit_error("Insufficient data for report generation")
            return {"error": "Insufficient data for report generation"}
        
        # Emit writing start
        await emit_writing_start(len(state.plan.report_outline))
        
        # Track total LLM calls for report generation
        report_llm_calls = 0
        report_input_tokens = 0
        report_output_tokens = 0
        report_call_details = []
        
        for attempt in range(self.max_retries):
            try:
                # Generate each section with retry
                report_sections = []
                total_sections = len(state.plan.report_outline)
                
                for section_idx, section_title in enumerate(state.plan.report_outline, 1):
                    # Emit progress for each section
                    await emit_writing_section(section_title, section_idx, total_sections)
                    
                    section, section_tokens = await self._write_section(
                        state.research_topic,
                        section_title,
                        state.search_results
                    )
                    if section:
                        report_sections.append(section)
                        if section_tokens:
                            report_llm_calls += 1
                            report_input_tokens += section_tokens['input_tokens']
                            report_output_tokens += section_tokens['output_tokens']
                            report_call_details.append(section_tokens)
                    
                    # Add a 4 second delay between sections to avoid OpenRouter free-tier rate limits
                    if section_idx < total_sections:
                        await asyncio.sleep(4)
                
                # Validate minimum quality
                if not report_sections:
                    raise ValueError("No report sections generated")
                
                # Create temporary state for compilation
                temp_state = ResearchState(
                    research_topic=state.research_topic,
                    plan=state.plan,
                    report_sections=report_sections
                )
                
                # Compile final report
                final_report = self._compile_report(temp_state)
                
                # Format citations in specified style
                if state.search_results:
                    final_report = self.citation_formatter.update_report_citations(
                        final_report,
                        style=self.citation_style,
                        search_results=state.search_results
                    )
                
                # Add credibility information to report if available
                if state.credibility_scores:
                    high_cred_sources = [
                        i+1 for i, score in enumerate(state.credibility_scores)
                        if score.get('level') == 'high'
                    ]
                    if high_cred_sources:
                        final_report += f"\n\n---\n\n**Note:** {len(high_cred_sources)} high-credibility sources were prioritized in this research."
                
                # Validate report length
                if len(final_report) < 500:
                    raise ValueError("Report too short - insufficient content")
                
                logger.info(f"Report generation complete: {len(final_report)} chars")
                
                # Emit writing completion
                await emit_writing_complete(len(final_report))
                
                # Return dict updates - LangGraph merges into state
                return {
                    "report_sections": report_sections,
                    "final_report": final_report,
                    "current_stage": "complete",
                    "iterations": state.iterations + 1,
                    "llm_calls": state.llm_calls + report_llm_calls,
                    "total_input_tokens": state.total_input_tokens + report_input_tokens,
                    "total_output_tokens": state.total_output_tokens + report_output_tokens,
                    "llm_call_details": state.llm_call_details + report_call_details
                }
                
            except Exception as e:
                logger.warning(f"Report attempt {attempt + 1} failed: {str(e)}")
                if attempt == self.max_retries - 1:
                    logger.error(f"Report generation failed after {self.max_retries} attempts")
                    return {
                        "error": f"Report writing failed: {str(e)}",
                        "iterations": state.iterations + 1
                    }
                else:
                    await asyncio.sleep(2 ** attempt)
        
        # Fallback if all retries exhausted
        return {
            "error": "Report generation failed: Maximum retries exceeded",
            "iterations": state.iterations + 1
        }
    
    async def _write_section(
        self,
        topic: str,
        section_title: str,
        search_results: List
    ) -> tuple:
        """Autonomously write a single report section using tools."""
        logger.info(f"Writing section: {section_title}")
        
        # Create system prompt for section writing
        system_prompt = f"""You are a distinguished research writer and subject matter expert. Your task is to write authoritative, accurate, and well-structured report sections that inform and educate readers.

## Writing Standards

### Content Quality Requirements
1. **Minimum Length**: {config.min_section_words} words - ensure you write comprehensive, detailed content
2. **Factual Accuracy**: Every claim must be grounded in the provided findings
3. **Proper Citations**: Use inline citations [1], [2], etc. for all factual claims
4. **Balanced Perspective**: Present multiple viewpoints when they exist
5. **Technical Precision**: Use correct terminology; don't oversimplify incorrectly
6. **Mathematical Notation**: Use standard LaTeX notation.
   - Use `$ ... $` for inline math (e.g., $E = mc^2$).
   - Use `$$ ... $$` for display equations on their own line.
   - **DO NOT** use `\( ... \)` or `\[ ... \]`.
   - **DO NOT** use bare square brackets `[ ... ]` for math.

### Structure & Formatting (Markdown)
- Use **bold** for key terms and important concepts
- Use bullet points or numbered lists for multiple items
- Use subheadings (### or ####) to organize complex sections
- Include specific examples, data points, or case studies when available
- Maintain logical flow from one paragraph to the next

### Writing Style Guidelines
- **Tone**: Professional, authoritative, but accessible
- **Voice**: Third-person academic style (avoid "I", "we", "you")
- **Clarity**: Explain complex concepts clearly; define technical terms
- **Conciseness**: Every sentence should add value; avoid filler
- **Precision**: Use specific language; avoid vague qualifiers like "very" or "many"

## Critical Accuracy Rules

### DO
- Base all claims on the provided source materials
- Cite sources for factual statements: "According to [1]..." or "Research indicates [2]..."
- Distinguish between established facts and emerging trends
- Note limitations or caveats when relevant
- Use specific numbers, dates, and names from sources
- Acknowledge when evidence is limited: "Available data suggests..."

### DO NOT
- Invent statistics, percentages, or specific numbers not in the sources
- Make claims that go beyond the provided information
- Present opinions as facts without attribution
- Ignore contradictions between sources
- Use placeholder text or generic filler content
- Oversimplify to the point of inaccuracy

## Section Writing Process

1. **Analyze**: Review the findings relevant to this section's topic
2. **Outline**: Mentally structure the key points to cover
3. **Draft**: Write comprehensive, detailed content with proper citations
4. **Refine**: Ensure logical flow, accuracy, and sufficient depth

## CRITICAL: Output Format

You MUST write the section content directly as your response. DO NOT use tools or provide meta-commentary.
Your entire response should be the section content in markdown format.

Start with the content immediately (the section title will be added automatically). 
Ensure proper spacing between paragraphs and aim for AT LEAST {config.min_section_words} words.

Example structure:
```
[Opening paragraph introducing the section topic]

[Main content paragraph with specific details and citations [1]]

### [Subheading if needed]

[Additional content with more citations [2], [3]]

[Concluding paragraph summarizing key points]
```"""
        
        # Create a simple chain without tools for cleaner content generation
        # Tools were causing issues with content extraction
        from langchain_core.prompts import ChatPromptTemplate
        from langchain_core.output_parsers import StrOutputParser
        
        prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            ("human", "{input}")
        ])
        
        try:
            start_time = time.time()
            
            # Prepare input message with source context
            sources_context = ""
            if search_results:
                sources_context_lines = []
                for i, r in enumerate(search_results[:10]):
                    content = r.content if hasattr(r, 'content') and r.content else getattr(r, 'snippet', '')
                    if len(content) > 30000:
                        content = content[:30000] + "... [truncated]"
                    sources_context_lines.append(f"[{i+1}] {getattr(r, 'title', 'Unknown')} ({getattr(r, 'url', 'Unknown')})\n{content}\n")
                sources_context = "\n\nAvailable Sources for Citation:\n" + "\n".join(sources_context_lines)
            
            input_message = f"""## Assignment: Write Report Section

**Research Topic**: {topic}
**Section Title**: {section_title}
**Minimum Word Count**: {config.min_section_words} words

---

### Source Materials to Synthesize:
{sources_context}

---

### Instructions:
1. Write a comprehensive section that covers the topic "{section_title}" thoroughly
2. Synthesize the provided source materials, extracting the most critical facts, adding context and explanation
3. Use inline citations [1], [2], etc. when referencing specific facts from sources
4. Maintain academic rigor while being accessible to general readers
5. Use markdown formatting for structure (bold, lists, subheadings as needed)
6. Ensure your response is AT LEAST {config.min_section_words} words

IMPORTANT: Your response should ONLY contain the section content in markdown format. 
Do NOT use any tools. Do NOT provide meta-commentary. Just write the section content directly.

Write the section content now:"""
            
            # Estimate input tokens
            input_tokens = estimate_tokens(input_message)
            
            # Execute section writing using simple chain
            chain = prompt | self.llm | StrOutputParser()
            content = await chain.ainvoke({"input": input_message})
            
            # Content should now be a clean string
            if not isinstance(content, str):
                content = str(content)
            
            # Track LLM call
            duration = time.time() - start_time
            output_tokens = estimate_tokens(content)
            call_detail = {
                'agent': 'ReportWriter',
                'operation': f'write_section_{section_title[:30]}',
                'model': config.model_name,
                'input_tokens': input_tokens,
                'output_tokens': output_tokens,
                'duration': round(duration, 2)
            }
            
            # Validate content is not empty
            if not content or len(content.strip()) < 50:
                logger.warning(f"Section '{section_title}' generated insufficient content: {len(content)} chars")
                logger.error(f"Cannot create section '{section_title}' - no content")
                return None, None
            
            # Extract cited sources
            import re
            citations = re.findall(r'\[(\d+)\]', content)
            source_urls = []
            for cite_num in set(citations):
                idx = int(cite_num) - 1
                if 0 <= idx < len(search_results):
                    source_urls.append(search_results[idx].url)
            
            section = ReportSection(
                title=section_title,
                content=content,
                sources=source_urls
            )
            
            logger.info(f"Successfully wrote section '{section_title}': {len(content)} chars")
            return section, call_detail
            
        except Exception as e:
            logger.error(f"Error writing section '{section_title}': {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return None, None
    
    def _compile_report(self, state: ResearchState) -> str:
        """Compile all sections into final report."""
        # Count actual sources from search results
        search_results = getattr(state, 'search_results', []) or []
        report_sections = getattr(state, 'report_sections', []) or []
        
        # Get unique URLs from search results
        unique_sources = set()
        for result in search_results:
            if hasattr(result, 'url') and result.url:
                unique_sources.add(result.url)
        
        # Also collect from report sections if they have sources
        for section in report_sections:
            if hasattr(section, 'sources'):
                unique_sources.update(section.sources)
        
        source_count = len(unique_sources) if unique_sources else len(search_results)
        
        report_parts = [
            f"# {state.research_topic}\n",
            f"**Deep Research Report**\n",
            f"\n## Executive Summary\n",
            f"This report provides a comprehensive analysis of {state.research_topic}. ",
            f"The research was conducted across **{source_count} sources** ",
            f"and synthesized into **{len(report_sections)} key sections**.\n",
            f"\n## Research Objectives\n"
        ]
        
        if state.plan and hasattr(state.plan, 'objectives'):
            for i, obj in enumerate(state.plan.objectives, 1):
                report_parts.append(f"{i}. {obj}\n")
        
        report_parts.append("\n---\n")
        
        # Add all sections
        has_references_section = False
        for section in report_sections:
            # Check if content already starts with the title as a heading
            content = section.content.strip()
            
            # Check if this section contains References
            if "## References" in content or section.title.lower() == "references":
                has_references_section = True
            
            if content.startswith(f"## {section.title}"):
                # Content already has heading, use as-is
                report_parts.append(f"\n{content}\n\n")
            else:
                # Add heading before content
                report_parts.append(f"\n## {section.title}\n\n")
                report_parts.append(content)
                report_parts.append("\n")
        
        # Only add references if not already present in sections
        if not has_references_section:
            # Add references from search results
            report_parts.append("\n---\n\n## References\n\n")
        
        # Build a list of (url, title) tuples from search results
        source_info = []
        seen_urls = set()
        
        for result in search_results:
            if hasattr(result, 'url') and result.url and result.url not in seen_urls:
                seen_urls.add(result.url)
                title = getattr(result, 'title', '')
                source_info.append((result.url, title))
        
        # Add sources from sections if available (if not already included)
        for section in report_sections:
            if hasattr(section, 'sources'):
                for url in section.sources:
                    if url not in seen_urls:
                        seen_urls.add(url)
                        source_info.append((url, ''))
        
        # Add formatted references (only once, outside the loop)
        if not has_references_section:
            if source_info:
                from src.utils.citations import CitationFormatter
                formatter = CitationFormatter()
                for i, (url, title) in enumerate(source_info[:30], 1):  # Top 30 sources
                    # Format citation in APA style
                    citation = formatter.format_apa(url, title)
                    report_parts.append(f"{i}. {citation}\n")
            else:
                report_parts.append("*No sources were available for this research.*\n")
        
        return "".join(report_parts)

