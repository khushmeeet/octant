<script lang="ts">
	import { page } from '$app/state';
	import FileScreen from '$lib/file/FileScreen.svelte';
	import { parseFile } from '$lib/nav/paths';
	import { recent } from '$lib/nav/recent.svelte';

	/** A file, with the blame gutter. The same screen as `/blob/…`. */
	const address = $derived(parseFile(page.params, true));

	$effect(() => {
		void recent.remember({ ...address.repo });
	});
</script>

<FileScreen {address} />
