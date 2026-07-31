variable "workspace" {
  type        = string
  description = "Absolute path to the repo root. Set via TF_VAR_workspace by workflow.yml (from ENSEMBLE_WORKSPACE)."
}
