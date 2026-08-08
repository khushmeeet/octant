<script lang="ts">
	import { GitHubSource, parseRepoRef, type RepoRef } from '$lib/source';
	import { ERROR_LABEL } from '$lib/source';
	import { store } from '$lib/store';
	import { resource } from '$lib/sync/resource.svelte';
	import Header from '$lib/ui/Header.svelte';
	import RightPanel from '$lib/ui/RightPanel.svelte';
	import Shell from '$lib/ui/Shell.svelte';
	import { count } from '$lib/ui/format';
	import type { PanelEntry } from '$lib/ui/types';

	/**
	 * Phase 2 probe. The Tree screen replaces this in Phase 3; until then the
	 * main region exists to show the cache doing what it promises — a repository
	 * summary that revalidates, a tree at a commit SHA that never does, and a
	 * label on each saying where the paint came from.
	 *
	 * Descend into a directory and come back: the second listing is a local read.
	 */
	let input = $state('sveltejs/svelte');
	let ref = $state<RepoRef | null>(null);
	let path = $state('');
	let invalid = $state<string | null>(null);

	const repo = resource(() => (ref ? GitHubSource.getRepo(ref) : null));

	// The tree is only addressable once we know what HEAD is — and asking for it
	// by SHA rather than by branch name is what makes the answer permanent.
	const head = $derived(repo.data?.head?.oid ?? null);
	const tree = resource(() => (ref && head ? GitHubSource.getTree(ref, head, path) : null));

	let cached = $state({ immutable: 0, mutable: 0 });

	$effect(() => {
		// Re-count whenever either resource settles.
		void repo.origin;
		void tree.origin;
		void tree.data;

		void Promise.all([store.count('immutable'), store.count('mutable')]).then(
			([immutable, mutable]) => {
				cached = { immutable, mutable };
			}
		);
	});

	function load(event: SubmitEvent) {
		event.preventDefault();

		const parsed = parseRepoRef(input);
		if (!parsed) {
			invalid = 'Name a repository as owner/name.';
			ref = null;
			return;
		}
		invalid = null;
		path = '';
		ref = parsed;
	}

	const crumbs = $derived(path ? path.split('/') : []);

	function descend(name: string) {
		path = path ? `${path}/${name}` : name;
	}

	function ascend(depth: number) {
		path = crumbs.slice(0, depth).join('/');
	}

	function size(bytes: number | null): string {
		if (bytes === null) return '';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	const about = $derived<PanelEntry[]>(
		repo.data
			? [
					{ key: 'Repository', value: repo.data.nameWithOwner, mono: true },
					{ key: 'Default', value: repo.data.defaultBranch ?? '—', mono: true },
					{ key: 'HEAD', value: repo.data.head?.abbreviatedOid ?? '—', mono: true },
					{ key: 'Visibility', value: repo.data.isPrivate ? 'Private' : 'Public' }
				]
			: [
					{ key: 'Immutable', value: count(cached.immutable), mono: true },
					{ key: 'Mutable', value: count(cached.mutable), mono: true }
				]
	);

	const open = $derived<PanelEntry[]>(
		repo.data ? [{ key: 'Pull requests', value: count(repo.data.counts.openPullRequests) }] : []
	);
</script>

{#snippet origin(what: { origin: 'cache' | 'network' | null; loading: boolean; stale: boolean })}
	<span class="origin" class:stale={what.stale}>
		{#if what.loading}
			loading
		{:else if what.origin === 'cache'}
			from cache{what.stale ? ' · revalidating' : ''}
		{:else if what.origin === 'network'}
			from network
		{/if}
	</span>
{/snippet}

{#snippet header()}
	<Header crumbs={repo.data ? [repo.data.owner, repo.data.name] : ['octant']} />
{/snippet}

{#snippet panel()}
	<RightPanel {about} {open} />
{/snippet}

<Shell {header} {panel}>
	<div class="probe">
		<h2>Cache and seams</h2>
		<p>
			A repository summary is mutable — it holds HEAD, so it is revalidated once its window passes.
			A tree addressed by commit SHA is immutable and is never asked for twice. Reload the page and
			both paint from IndexedDB.
		</p>

		<form onsubmit={load}>
			<label class="lbl" for="repo">Repository</label>
			<input
				id="repo"
				class="mono"
				bind:value={input}
				autocomplete="off"
				autocorrect="off"
				spellcheck="false"
				placeholder="owner/name"
			/>
			<button type="submit">Fetch</button>
			<button type="button" onclick={() => repo.refresh()} disabled={!ref}>Refresh</button>
		</form>

		{#if invalid}
			<p class="err" role="alert"><b>Bad request</b>{invalid}</p>
		{:else if repo.error && !repo.data}
			<p class="err" role="alert"><b>{ERROR_LABEL[repo.error.kind]}</b>{repo.error.message}</p>
		{:else if repo.error}
			<!-- Data on screen and a failed refresh behind it. Both are true. -->
			<p class="warn" role="status">
				<b>{ERROR_LABEL[repo.error.kind]}</b>Showing what was cached. {repo.error.message}
			</p>
		{/if}

		{#if repo.data}
			<section>
				<h3>
					Repository <span class="tag">mutable</span>
					{@render origin(repo)}
				</h3>
				<dl>
					<dt>Repository</dt>
					<dd class="mono">{repo.data.nameWithOwner}</dd>

					<dt>HEAD</dt>
					<dd>
						{#if repo.data.head}
							<span class="mono">{repo.data.head.abbreviatedOid}</span>
							{repo.data.head.messageHeadline}
						{:else}
							—
						{/if}
					</dd>

					<dt>Commits</dt>
					<dd>{count(repo.data.counts.commits)}</dd>

					<dt>Branches · tags</dt>
					<dd>{count(repo.data.counts.branches)} · {count(repo.data.counts.tags)}</dd>
				</dl>
			</section>

			<section>
				<h3>
					Tree <span class="tag">immutable</span>
					{@render origin(tree)}
				</h3>

				<nav class="crumbs mono" aria-label="Path">
					<button type="button" onclick={() => ascend(0)} disabled={crumbs.length === 0}>/</button>
					{#each crumbs as crumb, index (index)}
						<span>/</span>
						<button
							type="button"
							onclick={() => ascend(index + 1)}
							disabled={index === crumbs.length - 1}>{crumb}</button
						>
					{/each}
				</nav>

				{#if tree.error && !tree.data}
					<p class="err" role="alert"><b>{ERROR_LABEL[tree.error.kind]}</b>{tree.error.message}</p>
				{:else if tree.data}
					<ul class="tree">
						{#each tree.data.entries as entry (entry.path)}
							<li>
								{#if entry.type === 'tree'}
									<button type="button" class="name mono dir" onclick={() => descend(entry.name)}>
										{entry.name}/
									</button>
								{:else}
									<span class="name mono">{entry.name}</span>
								{/if}
								<span class="mode mono">{entry.mode}</span>
								<span class="size mono">{size(entry.byteSize)}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}

		<p class="next">
			Phase 2 of 10. Cached: <span class="mono">{count(cached.immutable)}</span> immutable,
			<span class="mono">{count(cached.mutable)}</span>
			mutable. The Tree screen that replaces this one is Phase 3.
		</p>
	</div>
</Shell>

<style>
	.probe {
		padding: 14px 16px;
		max-width: 74ch;
	}

	h2 {
		font-size: 15px;
		font-weight: 600;
		margin: 0 0 4px;
	}

	h3 {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
		font-weight: 500;
		color: var(--tx3);
		margin: 0 0 8px;
	}

	p {
		margin: 0;
		color: var(--tx2);
	}

	section {
		margin-top: 20px;
		padding-top: 16px;
		border-top: 1px solid var(--bd);
	}

	.tag {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--tx3);
		border: 1px solid var(--bd);
		border-radius: var(--radius-pill);
		padding: 1px 6px;
	}

	.origin {
		margin-left: auto;
		font-size: 11px;
		color: var(--acc-tx);
	}

	.origin.stale {
		color: var(--tx3);
	}

	form {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 16px 0;
	}

	.lbl {
		font-size: 11px;
		font-weight: 500;
		color: var(--tx3);
	}

	input {
		flex: 1;
		min-width: 0;
		background: var(--bg);
		border: 1px solid var(--bd);
		border-radius: var(--radius-pill);
		padding: 5px 10px;
		color: var(--tx);
		transition: border-color 120ms;
	}

	input::placeholder {
		color: var(--tx3);
	}

	input:hover {
		border-color: var(--bd2);
	}

	form button {
		background: var(--raise);
		border: 1px solid var(--bd);
		border-radius: var(--radius-pill);
		padding: 5px 12px;
		color: var(--tx);
		font-weight: 500;
		transition: border-color 120ms;
	}

	form button:hover:not(:disabled) {
		border-color: var(--bd2);
	}

	form button:disabled {
		color: var(--tx3);
	}

	.err,
	.warn {
		color: var(--tx2);
	}

	.err b,
	.warn b {
		font-weight: 500;
		margin-right: 8px;
	}

	.err b {
		color: var(--no);
	}

	.warn b {
		color: var(--wn);
	}

	dl {
		display: grid;
		grid-template-columns: 128px 1fr;
		align-items: baseline;
		gap: 0 12px;
		margin: 0;
	}

	dt {
		font-size: 12px;
		color: var(--tx3);
		padding: 5px 0;
	}

	dd {
		margin: 0;
		padding: 5px 0;
		color: var(--tx);
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.crumbs {
		display: flex;
		align-items: center;
		gap: 2px;
		font-size: 12px;
		color: var(--tx3);
		margin-bottom: 4px;
	}

	.crumbs button {
		color: var(--acc-tx);
		padding: 2px 3px;
	}

	.crumbs button:disabled {
		color: var(--tx2);
	}

	.tree {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.tree li {
		display: flex;
		align-items: center;
		height: var(--row-h);
		border-bottom: 1px solid var(--bd);
	}

	.tree li:hover {
		background: var(--hover);
	}

	.name {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		color: var(--tx);
		text-align: left;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dir {
		color: var(--acc-tx);
	}

	.mode,
	.size {
		font-size: 11px;
		color: var(--tx3);
		text-align: right;
	}

	.mode {
		width: 72px;
	}

	.size {
		width: 72px;
	}

	.next {
		margin-top: 20px;
		color: var(--tx3);
	}
</style>
