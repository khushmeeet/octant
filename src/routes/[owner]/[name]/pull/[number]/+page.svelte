<script lang="ts">
	import { page } from '$app/state';
	import { parsePull } from '$lib/nav/paths';
	import { recent } from '$lib/nav/recent.svelte';
	import PullScreen from '$lib/review/PullScreen.svelte';

	/**
	 * One pull request, diff first.
	 *
	 * `?view=` is a parameter and not a segment for the usual reason — the two
	 * diffs are two views of one object — but it is the one parameter in the app
	 * whose absence is not a default. A URL that does not say leaves the screen
	 * to decide from what you have already reviewed, which is what makes "since
	 * my last review" a default view rather than an option (PLAN.md Phase 7).
	 */
	const address = $derived(parsePull(page.params, page.url.searchParams));

	$effect(() => {
		void recent.remember({ ...address.repo });
	});
</script>

<PullScreen {address} />
