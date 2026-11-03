-------------------- MODULE FileOpening --------------------
EXTENDS Naturals, FiniteSets
Targets == {"file", "change"}
VARIABLES generation, mounted, next, latest, requests, effects
vars == <<generation, mounted, next, latest, requests, effects>>
Init == /\ generation = 0 /\ mounted = TRUE /\ next = 1
        /\ latest = [t \in Targets |-> 0] /\ requests = {} /\ effects = {}
Click(t) == /\ mounted /\ next <= 2
            /\ requests' = requests \cup {[born |-> generation, number |-> next, target |-> t]}
            /\ latest' = [latest EXCEPT ![t] = next] /\ next' = next + 1
            /\ UNCHANGED <<generation, mounted, effects>>
ChangeIdentity == /\ mounted /\ generation = 0 /\ generation' = 1
                  /\ latest' = [t \in Targets |-> 0] /\ next' = 1
                  /\ UNCHANGED <<mounted, requests, effects>>
Unmount == /\ mounted /\ mounted' = FALSE
           /\ UNCHANGED <<generation, next, latest, requests, effects>>
OpenLink(q) == /\ q \in requests
               /\ mounted /\ q.born = generation /\ q.number = latest[q.target]
               /\ effects' = effects \cup {[born |-> q.born, currentGeneration |-> generation,
                    number |-> q.number, currentNumber |-> latest[q.target], wasMounted |-> mounted]}
               /\ UNCHANGED <<generation, mounted, next, latest, requests>>
Next == (\E t \in Targets : Click(t)) \/ ChangeIdentity \/ Unmount \/ (\E q \in requests : OpenLink(q))
Spec == Init /\ [][Next]_vars
CurrentGenerationOnly == \A e \in effects : e.born = e.currentGeneration
LatestTargetOnly == \A e \in effects : e.number = e.currentNumber
MountedOnly == \A e \in effects : e.wasMounted
============================================================
