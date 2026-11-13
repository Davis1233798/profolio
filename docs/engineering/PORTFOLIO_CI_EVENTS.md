# Portfolio CI event boundary

Pull requests run the full validation workflow. Pushes to main run validation
and retain OCI publication. A feature branch push is validated through its
pull request, which removes the second run for the same change.

Verify that the workflow includes pull_request and restricts push to main.
Verify that production deployment remains gated on a push to the default
branch and depends on the existing validation jobs.
