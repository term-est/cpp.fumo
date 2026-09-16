type SupabaseSession = {
  user: { id: string };
};

type SupabaseResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

type SupabaseQuery = PromiseLike<SupabaseResult<unknown>> & {
  select(columns?: string): SupabaseQuery;
  eq(column: string, value: string | number): SupabaseQuery;
  upsert(
    values: Record<string, unknown>,
    options?: { onConflict?: string },
  ): SupabaseQuery;
  delete(): SupabaseQuery;
};

type SupabaseClient = {
  auth: {
    getSession(): Promise<
      SupabaseResult<{ session: SupabaseSession | null }>
    >;
    signInWithOAuth(options: {
      provider: "github";
      options?: { redirectTo?: string };
    }): Promise<SupabaseResult<unknown>>;
    onAuthStateChange(
      callback: (event: string, session: SupabaseSession | null) => void,
    ): { data: { subscription: { unsubscribe(): void } } };
  };
  from(table: string): SupabaseQuery;
};

type SupabaseGlobal = {
  createClient(url: string, publishableKey: string): SupabaseClient;
};

declare global {
  interface Window {
    supabase?: SupabaseGlobal;
  }
}

type Vote = -1 | 0 | 1;

type ScoreRow = {
  blog_id: string;
  score: number;
};

type VoteRow = {
  blog_id: string;
  value: -1 | 1;
};

const SUPABASE_URL = "https://sguatfsyidvmtrrfqkor.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_OAxfyqnY7AgBl4zVXa7jUg_qu5h3tOZ";

function voteElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-blog-vote]"));
}

function setScore(element: HTMLElement, score: number): void {
  element.dataset.score = String(score);
  const output = element.querySelector<HTMLOutputElement>(
    "[data-blog-vote-score]",
  );
  if (output) output.value = String(score);
}

function setVote(element: HTMLElement, vote: Vote): void {
  element.dataset.vote = String(vote);
  element
    .querySelectorAll<HTMLButtonElement>("[data-blog-vote-value]")
    .forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.blogVoteValue) === vote),
      );
    });
}

function setBusy(element: HTMLElement, busy: boolean): void {
  element.setAttribute("aria-busy", String(busy));
  element
    .querySelectorAll<HTMLButtonElement>("[data-blog-vote-value]")
    .forEach((button) => {
      button.disabled = busy;
    });
}

let orderObserver: MutationObserver | null = null;

function sortByScore(): void {
  const grid = document.querySelector<HTMLElement>(".blog-grid");
  if (!grid) return;

  if (!orderObserver) {
    const searchInput = document.querySelector<HTMLInputElement>(
      "[data-directory-input]",
    );
    orderObserver = new MutationObserver(() => {
      if (!searchInput?.value.trim()) sortByScore();
    });
    orderObserver.observe(grid, { childList: true });
  }

  const score = (card: HTMLElement): number =>
    Number(
      card.querySelector<HTMLElement>("[data-blog-vote]")?.dataset.score ?? 0,
    );

  const cards = Array.from(
    grid.querySelectorAll<HTMLElement>(":scope > .blog-card"),
  );
  cards.sort((left, right) => {
    const difference = score(right) - score(left);
    if (difference) return difference;
    return (left.dataset.searchTitle ?? "").localeCompare(
      right.dataset.searchTitle ?? "",
      undefined,
      { sensitivity: "base" },
    );
  });

  const current = Array.from(grid.children);
  if (cards.every((card, index) => card === current[index])) return;
  grid.append(...cards);
}

function redirectTarget(): string {
  const url = new URL(window.location.href);
  url.hash = "";
  return url.href;
}

export async function initBlogVoting(): Promise<void> {
  const elements = voteElements();
  const sdk = window.supabase;
  if (!elements.length || !sdk) return;

  const client = sdk.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  const byId = new Map(
    elements.map((element) => [element.dataset.blogId || "", element]),
  );

  async function loadScores(): Promise<void> {
    const result = (await client
      .from("blog_vote_scores")
      .select("blog_id,score")) as SupabaseResult<ScoreRow[]>;
    if (result.error) {
      console.warn("Unable to load blog vote scores:", result.error.message);
      return;
    }
    for (const element of elements) setScore(element, 0);
    for (const row of result.data || []) {
      const element = byId.get(row.blog_id);
      if (element) setScore(element, Number(row.score) || 0);
    }
    sortByScore();
  }

  async function loadUserVotes(session: SupabaseSession | null): Promise<void> {
    for (const element of elements) setVote(element, 0);
    if (!session) return;

    const result = (await client
      .from("blog_votes")
      .select("blog_id,value")) as SupabaseResult<VoteRow[]>;
    if (result.error) {
      console.warn("Unable to load blog votes:", result.error.message);
      return;
    }
    for (const row of result.data || []) {
      const element = byId.get(row.blog_id);
      if (element) setVote(element, row.value);
    }
  }

  let session = (await client.auth.getSession()).data?.session ?? null;
  await Promise.all([loadScores(), loadUserVotes(session)]);

  client.auth.onAuthStateChange((_event, nextSession) => {
    session = nextSession;
    void loadUserVotes(session);
  });

  for (const element of elements) {
    element.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>(
        "[data-blog-vote-value]",
      );
      if (!button) return;

      event.preventDefault();
      event.stopPropagation();

      if (!session) {
        const result = await client.auth.signInWithOAuth({
          provider: "github",
          options: { redirectTo: redirectTarget() },
        });
        if (result.error) {
          console.error(
            "Unable to start GitHub sign-in:",
            result.error.message,
          );
        }
        return;
      }

      const blogId = element.dataset.blogId || "";
      const next = Number(button.dataset.blogVoteValue) as -1 | 1;
      const previous = Number(element.dataset.vote || 0) as Vote;
      if (!blogId) return;

      setBusy(element, true);
      try {
        const result =
          previous === next
            ? ((await client
                .from("blog_votes")
                .delete()
                .eq("blog_id", blogId)) as SupabaseResult<unknown>)
            : ((await client.from("blog_votes").upsert(
                {
                  user_id: session.user.id,
                  blog_id: blogId,
                  value: next,
                },
                { onConflict: "user_id,blog_id" },
              )) as SupabaseResult<unknown>);

        if (result.error) throw new Error(result.error.message);
        await Promise.all([loadScores(), loadUserVotes(session)]);
      } catch (error) {
        console.error("Unable to update blog vote:", error);
      } finally {
        setBusy(element, false);
      }
    });
  }
}

void initBlogVoting();
