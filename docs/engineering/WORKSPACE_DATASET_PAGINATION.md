# Workspace dataset table pagination

Only workspace dataset tables use client-side pagination. They show 50 rows per page over the already loaded, organization-authorized data; the API's existing 500-row query cap and authorization boundary remain unchanged. Search continues to filter that loaded result set and resets the table to its first page when the filtered rows change.

The portfolio station already supports server-side dataset search and 500-record windows through `DatasetTable`. Keep its search form, offset, loaded-range warning and newer/older record controls. The new 50-row renderer pages within that currently loaded window; it must not replace those server controls or imply that the loaded window contains every stored record. A successful server search/window replacement resets the inner page while unrelated preview toggles preserve it. No server request, timer or cache is introduced by changing the inner page.

PrintCenter tables remain complete and unpaginated, including document line details. Summary metrics and compact tables keep their existing behavior. Pagination changes do not own or clear form drafts, auth state, or the underlying dataset.

The Playwright fixture covers 500 rows across first, next, and last pages, search while on the last page, a 390px viewport, and a 675-line print document with no pagination. It makes no business API writes.

The server-window regression also checks that inner-page navigation performs no
requests, loading the next 500-record window resets the inner page, and server
search returns to offset zero. The initial test-only remote run was still in
its preceding transaction checks when implementation began; no observed remote
red result is claimed for this portfolio change. Validation runs in GitHub CI.

TanStack Table v9 uses `useTable`, `tableFeatures`, `rowPaginationFeature`, and `createPaginatedRowModel` for this client-side table. See the [official React pagination guide](https://tanstack.com/table/latest/docs/framework/react/guide/pagination) and [pagination example](https://tanstack.com/table/latest/docs/framework/react/examples/pagination).
