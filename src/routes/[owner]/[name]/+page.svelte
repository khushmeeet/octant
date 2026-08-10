<script lang="ts">
	import { page } from '$app/state';
	import { recent } from '$lib/nav/recent.svelte';
	import SummaryScreen from '$lib/summary/SummaryScreen.svelte';

	/**
	 * A repository's own address: what it is, what just landed, and its README.
	 *
	 * This route rendered the tree until the summary took it. The tree is a
	 * screen about a directory and now says so in its URL — `/tree/HEAD` even at
	 * the root — which leaves the repository's front page free to be about the
	 * repository. `nav/paths.ts` draws the line: a breadcrumb that names the
	 * repository points here, and every verb that says *browse* points there.
	 */
	const repo = $derived({ owner: page.params.owner ?? '', name: page.params.name ?? '' });

	$effect(() => {
		void recent.remember({ ...repo });
	});
</script>

<SummaryScreen {repo} />
