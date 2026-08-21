# Déplacer ce projet vers son propre repo

Ce dossier n'a rien à voir avec le thème Shopify qui l'entoure : il n'est ici
que parce que la session n'avait pas le droit de créer un repo GitHub. Pour le
sortir, en gardant l'historique de ce dossier uniquement :

```bash
# 1. Créer un repo vide "turtle-cam" sur GitHub (sans README ni .gitignore)

# 2. Extraire le dossier dans son propre dépôt
cd /chemin/vers/novaly-theme
git subtree split --prefix=turtle-cam -b turtle-cam-only

git clone . /tmp/turtle-cam --branch turtle-cam-only
cd /tmp/turtle-cam
git remote set-url origin git@github.com:<votre-compte>/turtle-cam.git
git branch -m main
git push -u origin main

# 3. Retirer le dossier du thème
cd /chemin/vers/novaly-theme
git rm -r turtle-cam && git commit -m "chore: sortir turtle-cam vers son repo"
```

Si l'historique n'a pas d'importance, un simple copier-coller du dossier dans un
nouveau dépôt suffit.
