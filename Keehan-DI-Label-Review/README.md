# Keehan DI Label Review — Team Handoff

Public landing page:

`https://plus-1-technology.github.io/client/Keehan-DI-Label-Review/`

The landing page provides one entry point for:

- Vendor Invoice review: 208 documents, 59 approved, 9,049 labels, 202 fields
- Packing Slip review: 134 documents, 27 approved, 5,426 labels, 166 fields
- Purchase Order review: 139 documents, 6,047 labels, 60 fields
- PO Received Status review: 10 focused documents, 1,433 labels, 61 fields

## Reviewer instructions

1. Open the public landing page.
2. Select the document type assigned to you.
3. Review, add, edit, or delete labels. Do not approve a document until its labels are complete.
4. The editor autosaves changes to the current browser profile.
5. Before switching computers or handing work to another person, click **Export full review backup**.
6. Send the exported JSON to the project owner or commit it to this folder as the next checkpoint.

Browser autosave is not a shared database. Another reviewer cannot see edits until an export is incorporated into GitHub.

## Updating a checkpoint

From this folder, run:

```powershell
py -3.13 update_from_export.py --review-export "C:\path\to\export.json"
py -3.13 build_manifest.py
```

The updater accepts either a full-review backup or an approved-training export. It validates the model, snapshot, field inventory, and document set before rebuilding the applicable editor data.

## Safety boundary

These files are static review artifacts. They do not call Azure Document Intelligence, train or publish models, or enable production processing.
