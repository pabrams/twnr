# README

This is a node-based websocket server for my trade wars 2002 nostalgia remake. 


## MONGO

Had to install MongoDb 6.0 in docker to get it to work in my WSL Ubuntu. 

``` bash
sudo apt install docker.io
sudo usermod -aG docker $USER
newgrp docker
docker pull mongo:6.0
docker run --name mongo -d -p 27017:27017 mongo:6.0
```
