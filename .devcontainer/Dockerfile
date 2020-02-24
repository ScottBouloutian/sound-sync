FROM ubuntu

RUN apt-get update \
    && apt-get install -y git curl locales gpg-agent zsh \
    && locale-gen en_US.UTF-8 \
    && sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh) --unattended" \
    && git clone https://github.com/bhilburn/powerlevel9k.git ~/.oh-my-zsh/custom/themes/powerlevel9k \
    && curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.35.2/install.sh | bash
