import { HubSpotClient } from "./hubspot";
import { QAExtractor } from "./ai/extractor";
import { Categorizer } from "./ai/categorizer";
import { mergeOrCreate } from "./ai/merger";
import { getProvider } from "./ai/provider";
import { extractTerms, extractTermsFromArticles } from "./ai/termExtractor";
import { Repository } from "./db/repository";
import { getDb } from "./db/index";
import { runScrape } from "./scraper";

export type PipelineEvent =
  | { type: "log"; message: string }
  | { type: "progress"; current: number; total: number; message: string }
  | { type: "done"; stats: PipelineStats }
  | { type: "error"; message: string };

export interface PipelineStats {
  tickets_fetched: number;
  tickets_new: number;
  qa_extracted: number;
  categories_total: number;
  reclustered: boolean;
  errors: number;
}

export interface PipelineOptions {
  mode: "incremental" | "full" | "recluster" | "test" | "scrape-kb";
  testLimit?: number;
  onProgress?: (event: PipelineEvent) => void;
}

export async function runPipeline(options: PipelineOptions): Promise<PipelineStats> {
  const { mode, onProgress } = options;
  const emit = (event: PipelineEvent) => onProgress?.(event);
  const log = (msg: string) => emit({ type: "log", message: msg });

  const stats: PipelineStats = {
    tickets_fetched: 0,
    tickets_new: 0,
    qa_extracted: 0,
    categories_total: 0,
    reclustered: false,
    errors: 0,
  };

  const repo = new Repository(getDb());
  const hubspot = new HubSpotClient(process.env.HUBSPOT_ACCESS_TOKEN!);
  const extractor = new QAExtractor();
  const categorizer = new Categorizer();

  // ── Recluster mode: only re-cluster ──────────────────────────────────────
  if (mode === "recluster") {
    log("Starting full re-clustering...");
    const all = repo.getAllQAWithCategories();
    if (all.length < 3) {
      log(`Only ${all.length} Q&A found. You need at least 3 for re-clustering.`);
      emit({ type: "done", stats });
      return stats;
    }
    await executeRecluster(repo, categorizer, all, log);
    stats.reclustered = true;
    stats.categories_total = repo.getAllCategories().length;
    log(`✓ Re-clustering completed: ${stats.categories_total} categories`);
    emit({ type: "done", stats });
    return stats;
  }

  // ── Scrape KB mode: scrape public knowledge base articles ────────────────
  if (mode === "scrape-kb") {
    log("Starting KB article scraping...");
    const scrapeStats = await runScrape((event) => {
      if (event.type === "log" || event.type === "progress") {
        log(event.message ?? "");
      }
      if (event.type === "progress" && event.current && event.total) {
        emit({ type: "progress", current: event.current, total: event.total, message: event.message ?? "" });
      }
    });
    log(`✓ Scraping complete: ${scrapeStats.created} created, ${scrapeStats.updated} updated, ${scrapeStats.unchanged} unchanged, ${scrapeStats.failed} failed`);
    stats.qa_extracted = scrapeStats.created + scrapeStats.updated;

    // Auto-extract glossary terms from scraped articles
    log("Extracting glossary terms from articles...");
    const allArticles = repo.getAllKBArticles();
    const BATCH_SIZE = 10;
    let termsCreated = 0;

    for (let i = 0; i < allArticles.length; i += BATCH_SIZE) {
      const batch = allArticles.slice(i, i + BATCH_SIZE);
      try {
        const existingTermNames = repo.getAllTerms().map((t) => t.name);
        const newTerms = await extractTermsFromArticles(
          batch.map((a) => ({ title: a.title, content: a.content })),
          existingTermNames,
        );
        for (const t of newTerms) {
          try {
            const term = repo.createTerm({ name: t.name, definition: t.definition, aliases: t.aliases });
            repo.autoLinkTermToAll(term.id);
            log(`  + Term: "${t.name}"`);
            termsCreated++;
          } catch { /* duplicate — skip */ }
        }
      } catch { /* non-critical */ }
      emit({ type: "progress", current: Math.min(i + BATCH_SIZE, allArticles.length), total: allArticles.length, message: `Extracting terms from articles...` });
    }

    log(`✓ Term extraction complete: ${termsCreated} new terms`);
    emit({ type: "done", stats });
    return stats;
  }

  // ── Test mode: fetch N tickets, show input/output, don't persist ─────────
  if (mode === "test") {
    const limit = options.testLimit ?? 3;
    log(`🧪 TEST MODE — Fetching ${limit} ticket(s), no data will be saved`);
    log("─".repeat(60));

    let rawTickets;
    try {
      rawTickets = await hubspot.getTickets({ limit });
      log(`✓ ${rawTickets.length} ticket(s) fetched from HubSpot`);
    } catch (err) {
      emit({ type: "error", message: `Error fetching tickets: ${err}` });
      return stats;
    }

    stats.tickets_fetched = rawTickets.length;
    let testCompleted = 0;

    // Collect results in order, but process concurrently
    const testResults: string[][] = new Array(rawTickets.length);

    await poolMap(rawTickets, async (raw, i) => {
      const subject = raw.properties.subject ?? "(no subject)";
      const content = raw.properties.content ?? "";
      const lines: string[] = [];
      const ln = (msg: string) => lines.push(msg);

      ln("");
      ln(`═══ Ticket ${i + 1}/${rawTickets.length}: ${subject} ═══`);
      ln(`ID: ${raw.id}`);
      ln(`Channel: ${HubSpotClient.mapChannel(raw.properties.source_type)}`);
      ln(`Priority: ${raw.properties.hs_ticket_priority ?? "n/a"}`);

      ln("");
      ln("── INPUT: Conversation ──");
      try {
        const { text: conversation, images } = await hubspot.getTicketConversation(raw.id);

        if (conversation) {
          const preview = conversation.length > 2000
            ? conversation.slice(0, 2000) + `\n... (${conversation.length} chars total)`
            : conversation;
          for (const line of preview.split("\n")) {
            ln(`  ${line}`);
          }
        } else {
          ln("  (no conversation text)");
        }

        if (images.length > 0) {
          ln(`  📎 ${images.length} image(s) attached: ${images.map((img) => img.name).join(", ")}`);
        }

        ln("");
        ln("── OUTPUT: AI Extraction ──");
        try {
          const qa = await extractor.extract(subject, content, conversation, images);

          ln(`  Question: ${qa.question}`);
          ln(`  Template: ${qa.question_template}`);
          if (qa.question_variables && Object.keys(qa.question_variables).length > 0) {
            ln(`  Variables: ${JSON.stringify(qa.question_variables)}`);
          }
          ln(`  Answer: ${(qa.answer ?? "").slice(0, 500)}${(qa.answer ?? "").length > 500 ? "..." : ""}`);
          if (qa.resolution_steps.length > 0) {
            ln(`  Steps: ${qa.resolution_steps.map((s, j) => `${j + 1}. ${s}`).join(" | ")}`);
          }
          ln(`  Summary: ${qa.summary}`);
          ln(`  Resolved: ${qa.resolved}`);
          ln(`  Channel: ${qa.channel}`);
          stats.qa_extracted++;
        } catch (err) {
          ln(`  ✗ Extraction error: ${err}`);
          stats.errors++;
        }
      } catch (err) {
        ln(`  ✗ Error fetching conversation: ${err}`);
        stats.errors++;
      }

      testResults[i] = lines;
      testCompleted++;
      emit({ type: "progress", current: testCompleted, total: rawTickets.length, message: `Testing: ${subject.slice(0, 60)}` });
    });

    // Flush results in ticket order
    for (const lines of testResults) {
      for (const line of lines) log(line);
    }

    log("");
    log("─".repeat(60));
    log(`🧪 TEST COMPLETE — ${stats.qa_extracted} extracted, ${stats.errors} errors, nothing saved`);
    emit({ type: "done", stats });
    return stats;
  }

  // ── 1. Fetch tickets from HubSpot ─────────────────────────────────────────
  log("Connecting to HubSpot...");
  const syncState = repo.getSyncState();
  const modifiedAfter =
    mode === "incremental" && syncState.last_sync_at
      ? new Date(syncState.last_sync_at * 1000)
      : null;

  if (modifiedAfter) {
    log(`Fetching tickets modified since ${modifiedAfter.toISOString().slice(0, 10)}`);
  } else {
    log("Fetching all tickets (full sync)...");
  }

  const syncLimit = parseInt(process.env.SYNC_LIMIT ?? "0", 10);

  let rawTickets: Awaited<ReturnType<HubSpotClient["getTickets"]>>;
  try {
    rawTickets = await hubspot.getTickets({
      modifiedAfter,
      limit: syncLimit,
      closedOnly: true,
    });
    stats.tickets_fetched = rawTickets.length;
    log(`✓ ${rawTickets.length} tickets fetched`);
  } catch (err) {
    emit({ type: "error", message: `Error fetching tickets: ${err}` });
    return stats;
  }

  // ── 2. Save to DB ─────────────────────────────────────────────────────────
  log("Saving tickets to database...");
  let newCount = 0;
  for (const raw of rawTickets) {
    const props = raw.properties;
    const existing = repo.getTicketByHubspotId(raw.id);
    if (!existing) newCount++;

    repo.upsertTicket({
      hubspot_id: raw.id,
      subject: props.subject,
      content: props.content,
      channel: HubSpotClient.mapChannel(props.source_type),
      status: props.hs_pipeline_stage,
      priority: props.hs_ticket_priority,
      hubspot_created_at: HubSpotClient.parseHubSpotDate(props.createdate),
      hubspot_updated_at: HubSpotClient.parseHubSpotDate(props.hs_lastmodifieddate),
    });
  }
  stats.tickets_new = newCount;
  log(`✓ ${newCount} new tickets saved`);

  // ── 3. Process unprocessed tickets (concurrent) ──────────────────────────
  const unprocessed = repo.getUnprocessedTickets();
  log(`Processing ${unprocessed.length} tickets with AI (concurrency: ${CONCURRENCY})...`);
  let completed = 0;

  await poolMap(unprocessed, async (ticket) => {
    const label = ticket.subject?.slice(0, 60) ?? `#${ticket.hubspot_id}`;

    try {
      // Fetch full conversation (text + any image attachments)
      const { text: conversation, images } = await hubspot.getTicketConversation(ticket.hubspot_id);

      // Extract Q&A with Gemini (multimodal: text + images)
      const qa = await extractor.extract(
        ticket.subject ?? "",
        ticket.content ?? "",
        conversation,
        images
      );

      // Categorize
      const existingCats = repo.getAllCategories().map((c) => ({
        name: c.name,
        description: c.description,
        count: c.qa_count,
      }));

      const catResult = await categorizer.categorizeSingle(
        {
          question: qa.question,
          question_template: qa.question_template,
          answer: qa.answer,
          resolved: qa.resolved,
        },
        existingCats
      );

      // Check for existing QAs from this ticket (merge-or-create)
      const existingQAs = repo.getQAPairsByTicketId(ticket.id);
      let qaPairId: number;
      let actionLabel: string;

      if (existingQAs.length > 0) {
        // AI decides: merge into existing or create new
        const mergeResult = await mergeOrCreate(qa, existingQAs);

        if (mergeResult.action === "merge" && mergeResult.merge_target_id && mergeResult.merged) {
          const m = mergeResult.merged;
          repo.updateQAPair(mergeResult.merge_target_id, {
            question: m.question,
            question_template: m.question_template,
            question_variables: JSON.stringify(m.question_variables),
            answer: m.answer,
            resolution_steps: m.resolution_steps.length > 0 ? JSON.stringify(m.resolution_steps) : null,
            summary: m.summary,
            resolved: m.resolved ? 1 : 0,
          });
          qaPairId = mergeResult.merge_target_id;
          actionLabel = "Merged";
        } else {
          const qaPair = repo.createQAPair({
            ticket_id: ticket.id,
            question: qa.question,
            question_template: qa.question_template,
            question_variables: JSON.stringify(qa.question_variables),
            answer: qa.answer,
            resolution_steps: qa.resolution_steps.length > 0 ? JSON.stringify(qa.resolution_steps) : null,
            summary: qa.summary,
            resolved: qa.resolved,
            channel: qa.channel || ticket.channel,
          });
          qaPairId = qaPair.id;
          actionLabel = "Created";
        }
      } else {
        const qaPair = repo.createQAPair({
          ticket_id: ticket.id,
          question: qa.question,
          question_template: qa.question_template,
          question_variables: JSON.stringify(qa.question_variables),
          answer: qa.answer,
          resolution_steps: qa.resolution_steps.length > 0 ? JSON.stringify(qa.resolution_steps) : null,
          summary: qa.summary,
          resolved: qa.resolved,
          channel: qa.channel || ticket.channel,
        });
        qaPairId = qaPair.id;
        actionLabel = "Created";
      }

      const category = repo.getOrCreateCategory(
        catResult.category_name,
        catResult.category_description
      );
      repo.assignCategory(qaPairId, category.id, catResult.confidence);

      // Auto-extract glossary terms from this QA
      try {
        const existingTermNames = repo.getAllTerms().map((t) => t.name);
        const newTerms = await extractTerms(
          { question: qa.question, answer: qa.answer, summary: qa.summary },
          existingTermNames,
        );
        for (const t of newTerms) {
          try {
            const term = repo.createTerm({ name: t.name, definition: t.definition, aliases: t.aliases });
            repo.autoLinkTermToAll(term.id);
            log(`    + Term: "${t.name}"`);
          } catch { /* duplicate name — just link existing */ }
        }
      } catch { /* non-critical — don't fail the pipeline */ }

      // Auto-link existing glossary terms to this QA
      repo.autoLinkTermsToQA(qaPairId);
      repo.markTicketProcessed(ticket.id);
      stats.qa_extracted++;

      const state = repo.getSyncState();
      repo.updateSyncState({
        new_qa_since_recluster: (state.new_qa_since_recluster ?? 0) + 1,
      });

      completed++;
      emit({ type: "progress", current: completed, total: unprocessed.length, message: `Processing: ${label}` });
      log(`  ✓ [${completed}/${unprocessed.length}] ${actionLabel} → ${label} → ${catResult.category_name}`);
    } catch (err) {
      stats.errors++;
      completed++;
      emit({ type: "progress", current: completed, total: unprocessed.length, message: `Processing: ${label}` });
      log(`  ✗ Error on ticket ${ticket.hubspot_id}: ${err}`);
    }
  });

  // ── 4. Automatic re-clustering ────────────────────────────────────────────
  const reclusterThreshold = parseInt(process.env.RECLUSTER_THRESHOLD ?? "20", 10);
  const state = repo.getSyncState();
  const newQA = state.new_qa_since_recluster ?? 0;

  if (newQA >= reclusterThreshold) {
    log(`Automatic re-clustering (${newQA} new Q&A ≥ threshold ${reclusterThreshold})...`);
    const all = repo.getAllQAWithCategories();
    await executeRecluster(repo, categorizer, all, log);
    stats.reclustered = true;
    repo.updateSyncState({ new_qa_since_recluster: 0 });
    log(`✓ Re-clustering completed`);
  }

  // ── 5. Update state ────────────────────────────────────────────────────────
  repo.refreshCategoryCounts();
  repo.updateSyncState({
    last_sync_at: Math.floor(Date.now() / 1000),
    last_run_at: Math.floor(Date.now() / 1000),
    tickets_synced_total: (state.tickets_synced_total ?? 0) + newCount,
    qa_pairs_total: repo.countQAPairs(),
  });

  stats.categories_total = repo.getAllCategories().length;
  emit({ type: "done", stats });
  return stats;
}

async function executeRecluster(
  repo: Repository,
  categorizer: Categorizer,
  all: ReturnType<Repository["getAllQAWithCategories"]>,
  log: (msg: string) => void
): Promise<void> {
  log(`Analyzing ${all.length} Q&A pairs for new taxonomy...`);
  repo.clearAllCategoryAssignments();

  const result = await categorizer.reclusterAll(all);

  const bulkAssigned = result.categories.reduce((sum, c) => sum + c.qa_ids.length, 0);
  log(`✓ Taxonomy created: ${result.categories.length} categories, ${bulkAssigned}/${all.length} Q&A assigned`);

  for (const cat of result.categories) {
    if (!cat.qa_ids.length) continue;
    const category = repo.getOrCreateCategory(cat.name, cat.description);
    for (const qaId of cat.qa_ids) {
      repo.assignCategory(qaId, category.id, 1.0);
    }
    log(`  • ${cat.name} (${cat.qa_ids.length})`);
  }

  // Individually categorize any QAs that recluster missed
  if (result.unassignedIds.length > 0) {
    const total = result.unassignedIds.length;
    log(`  ${total} Q&A not assigned by recluster — categorizing individually (concurrency: 15)...`);
    const qaMap = new Map(all.map((qa) => [qa.id, qa]));
    let done = 0;

    await poolMap(result.unassignedIds, async (qaId) => {
      const qa = qaMap.get(qaId);
      if (!qa) { done++; return; }

      try {
        const existingCats = repo.getAllCategories().map((c) => ({
          name: c.name,
          description: c.description,
          count: c.qa_count,
        }));

        const catResult = await categorizer.categorizeSingle(
          {
            question: qa.question,
            question_template: qa.question_template,
            answer: qa.answer,
            resolved: !!qa.resolved,
          },
          existingCats
        );

        const category = repo.getOrCreateCategory(
          catResult.category_name,
          catResult.category_description
        );
        repo.assignCategory(qa.id, category.id, catResult.confidence);
        done++;
        log(`    ✓ [${done}/${total}] Q&A #${qaId} → ${catResult.category_name}`);
      } catch {
        done++;
        log(`    ✗ [${done}/${total}] Could not categorize Q&A #${qaId}`);
      }
    }, 15);
  }

  repo.refreshCategoryCounts();
}

// Lower concurrency for Claude to avoid rate limits (10k input tokens/min on free tier)
const CONCURRENCY = getProvider() === "claude" ? 3 : 10;

async function poolMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = CONCURRENCY,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

