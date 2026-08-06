id           = "shared-nfs"
name         = "shared-nfs"
type         = "csi"
plugin_id    = "nfs"

capability {
  access_mode     = "multi-node-multi-writer"
  attachment_mode = "file-system"
}

context {
  server = "10.182.220.249"
  share  = "/var/nfs/general"
}