#!/bin/zsh

export GIT_TERMINAL_PROMPT=0

mkdir -p $HOME/downloads
cd $HOME/downloads


# oh-my-zsh & plugins
wget https://github.com/robbyrussell/oh-my-zsh/raw/master/tools/install.sh -O - | zsh || true
zsh -c 'git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions'
zsh -c 'git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting'

# tfenv
git clone https://github.com/tfutils/tfenv.git ~/.tfenv
echo 'export PATH="$HOME/.tfenv/bin:$PATH"' >> ~/.zshrc
$HOME/.tfenv/bin/tfenv install latest
$HOME/.tfenv/bin/tfenv use latest

# ensemble
curl -fsSL https://raw.githubusercontent.com/ritajhq/ensemble/main/.ensemble/install.sh | sh
echo 'export PATH="$HOME/.ensemble/bin:$PATH"' >> ~/.zshrc

# opa (Open Policy Agent CLI — compiles .rego policies, incl. to WASM, for judge-opa)
mkdir -p ~/.local/bin
curl -fsSL -o ~/.local/bin/opa https://openpolicyagent.org/downloads/v1.18.2/opa_linux_amd64_static
chmod 755 ~/.local/bin/opa
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc

# terraform-provider-dockercompose isn't published to the public registry —
# `terraform init` can't resolve ritaj/dockercompose. The binary is baked
# into the image (see Dockerfile) at ~/.terraform.d/plugin-bin; point
# Terraform at it via a CLI dev override so `terraform plan`/`apply` use it
# directly, skipping `init`'s registry lookup for this provider entirely.
cat > "$HOME/.terraformrc" <<EOF
provider_installation {
  dev_overrides {
    "ritaj/dockercompose" = "$HOME/.terraform.d/plugin-bin"
  }
  direct {}
}
EOF